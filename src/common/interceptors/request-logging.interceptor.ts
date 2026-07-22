import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { ObservabilityService } from '../../observability/observability.service';
import { RequestContextService } from '../../observability/request-context.service';

interface HttpRequestWithMetadata {
  method: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  query?: {
    view?: string;
  };
  route?: {
    path?: string | string[];
  };
  user?: { id?: string };
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(
    private readonly observability: ObservabilityService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestWithMetadata>();
    const response = http.getResponse<{ statusCode: number }>();
    const rawPath = stripQueryString(request.originalUrl ?? request.url ?? '');
    const isOperationsCurrent = rawPath === '/games/operations/current';
    let responseBody: unknown;

    this.observability.incrementActiveHttpRequests();
    if (isOperationsCurrent) {
      this.observability.incrementOperationsCurrentActiveRequests();
    }

    return next.handle().pipe(
      tap((data) => {
        responseBody = data;
      }),
      finalize(() => {
        const durationSeconds =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        const durationMs = Math.round(durationSeconds * 1000);
        const path = request.originalUrl ?? request.url ?? '';
        const normalizedRoute = this.resolveNormalizedRoute(request);
        const userId = request.user?.id ?? 'anonymous';
        const requestId = this.requestContext.getRequestIdForLog();

        this.observability.recordHttpRequest({
          method: request.method,
          route: normalizedRoute,
          statusCode: response.statusCode,
          durationSeconds,
        });
        this.observability.decrementActiveHttpRequests();

        if (isOperationsCurrent) {
          this.observability.decrementOperationsCurrentActiveRequests();
        }

        if (
          normalizedRoute === '/games/sessions/:id/registration-state' &&
          responseBody !== undefined
        ) {
          this.observability.recordRegistrationStateResponseSize(
            measurePayloadBytes(responseBody),
            request.query?.view ?? 'full',
          );
        }

        this.logger.log(
          `requestId=${requestId} ${request.method} ${path} route=${normalizedRoute} userId=${userId} status=${response.statusCode} durationMs=${durationMs}`,
        );
      }),
    );
  }

  private resolveNormalizedRoute(request: HttpRequestWithMetadata): string {
    const routePath = request.route?.path;
    const path =
      typeof routePath === 'string'
        ? routePath
        : Array.isArray(routePath)
          ? routePath.join('|')
          : '';

    if (!path) {
      return 'unmatched';
    }

    return `${request.baseUrl?.trim() ?? ''}${path}` || 'unmatched';
  }
}

function stripQueryString(value: string): string {
  const queryIndex = value.indexOf('?');
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function measurePayloadBytes(payload: unknown): number {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload, 'utf8');
  }

  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}
