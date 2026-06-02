import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      user?: { id?: string };
    }>();
    const response = http.getResponse<{ statusCode: number }>();

    return next.handle().pipe(
      finalize(() => {
        const duration = Date.now() - startedAt;
        const path = request.originalUrl ?? request.url ?? '';
        const userId = request.user?.id ?? 'anonymous';

        this.logger.log(
          `${request.method} ${path} userId=${userId} status=${response.statusCode} durationMs=${duration}`,
        );
      }),
    );
  }
}
