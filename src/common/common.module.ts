import { Global, Module } from '@nestjs/common';
import { RequestLoggingInterceptor } from './interceptors/request-logging.interceptor';
import { SuccessResponseInterceptor } from './interceptors/success-response.interceptor';
import { RequestPerformanceContext } from './performance/request-performance.context';
import { InMemoryRateLimiterService } from './rate-limit/in-memory-rate-limiter.service';
import { UserActionRateLimitService } from './rate-limit/user-action-rate-limit.service';
import { AuditLogService } from './services/audit-log.service';

@Global()
@Module({
  providers: [
    AuditLogService,
    InMemoryRateLimiterService,
    UserActionRateLimitService,
    RequestPerformanceContext,
    RequestLoggingInterceptor,
    SuccessResponseInterceptor,
  ],
  exports: [
    AuditLogService,
    InMemoryRateLimiterService,
    UserActionRateLimitService,
    RequestPerformanceContext,
    RequestLoggingInterceptor,
    SuccessResponseInterceptor,
  ],
})
export class CommonModule {}
