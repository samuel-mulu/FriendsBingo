import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class SuccessResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { originalUrl?: string }>();

    return next.handle().pipe(
      map((data) => {
        const timestamp = new Date().toISOString();
        const path = request.originalUrl ?? request.url;

        if (
          typeof data === 'object' &&
          data !== null &&
          'items' in data &&
          'pagination' in data
        ) {
          const paginated = data as {
            items: unknown;
            pagination: unknown;
          };

          return {
            success: true,
            data: paginated.items,
            meta: {
              pagination: paginated.pagination,
            },
            timestamp,
            path,
          };
        }

        return {
          success: true,
          data,
          timestamp,
          path,
        };
      }),
    );
  }
}
