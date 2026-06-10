import { HttpException, HttpStatus } from '@nestjs/common';
import { InMemoryRateLimiterService } from './in-memory-rate-limiter.service';
import {
  USER_ACTION_RATE_LIMIT_MESSAGE,
  UserActionRateLimitService,
} from './user-action-rate-limit.service';

describe('UserActionRateLimitService', () => {
  it('returns a clear 429 message for reserve actions', () => {
    const limiter = new InMemoryRateLimiterService();
    const service = new UserActionRateLimitService(limiter);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      service.assertWithinLimit('reserve', 'user-1');
    }

    try {
      service.assertWithinLimit('reserve', 'user-1');
      fail('Expected rate limit to be exceeded');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(httpError.message).toBe(USER_ACTION_RATE_LIMIT_MESSAGE);
    }
  });

  it('scopes bingo claims per user and session', () => {
    const limiter = new InMemoryRateLimiterService();
    const service = new UserActionRateLimitService(limiter);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(() =>
        service.assertWithinLimit('bingo_claim', 'user-1', 'session-1'),
      ).not.toThrow();
    }

    expect(() =>
      service.assertWithinLimit('bingo_claim', 'user-1', 'session-1'),
    ).toThrow(HttpException);

    expect(() =>
      service.assertWithinLimit('bingo_claim', 'user-1', 'session-2'),
    ).not.toThrow();
  });
});
