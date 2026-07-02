import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InMemoryRateLimiterService } from './in-memory-rate-limiter.service';

export const USER_ACTION_RATE_LIMIT_MESSAGE =
  'Too many attempts. Please wait a moment.';

export type UserActionRateLimitAction =
  | 'reserve'
  | 'confirm'
  | 'cancel'
  | 'bingo_claim'
  | 'withdrawal_request'
  | 'deposit_request'
  | 'deposit_check_ref'
  | 'support_message';

const ACTION_LIMITS: Record<
  UserActionRateLimitAction,
  { limit: number; windowMs: number }
> = {
  reserve: { limit: 60, windowMs: 60_000 },
  confirm: { limit: 60, windowMs: 60_000 },
  cancel: { limit: 60, windowMs: 60_000 },
  bingo_claim: { limit: 20, windowMs: 60_000 },
  withdrawal_request: { limit: 5, windowMs: 60_000 },
  deposit_request: { limit: 10, windowMs: 60_000 },
  deposit_check_ref: { limit: 30, windowMs: 60_000 },
  support_message: { limit: 5, windowMs: 3_600_000 },
};

@Injectable()
export class UserActionRateLimitService {
  constructor(
    private readonly inMemoryRateLimiterService: InMemoryRateLimiterService,
  ) {}

  assertWithinLimit(
    action: UserActionRateLimitAction,
    userId: string,
    scopeKey?: string,
  ): void {
    const { limit, windowMs } = ACTION_LIMITS[action];
    const key = scopeKey
      ? `${action}:${userId}:${scopeKey}`
      : `${action}:${userId}`;

    const allowed = this.inMemoryRateLimiterService.consume(
      key,
      limit,
      windowMs,
    );

    if (!allowed) {
      throw new HttpException(
        USER_ACTION_RATE_LIMIT_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
