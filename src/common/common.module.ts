import { Global, Module } from '@nestjs/common';
import { InMemoryRateLimiterService } from './rate-limit/in-memory-rate-limiter.service';
import { UserActionRateLimitService } from './rate-limit/user-action-rate-limit.service';
import { AuditLogService } from './services/audit-log.service';

@Global()
@Module({
  providers: [
    AuditLogService,
    InMemoryRateLimiterService,
    UserActionRateLimitService,
  ],
  exports: [
    AuditLogService,
    InMemoryRateLimiterService,
    UserActionRateLimitService,
  ],
})
export class CommonModule {}
