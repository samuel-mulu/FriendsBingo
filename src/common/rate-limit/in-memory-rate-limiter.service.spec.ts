import { InMemoryRateLimiterService } from './in-memory-rate-limiter.service';

describe('InMemoryRateLimiterService', () => {
  it('allows requests up to the configured limit', () => {
    const limiter = new InMemoryRateLimiterService();

    expect(limiter.consume('user:reserve', 3, 60_000)).toBe(true);
    expect(limiter.consume('user:reserve', 3, 60_000)).toBe(true);
    expect(limiter.consume('user:reserve', 3, 60_000)).toBe(true);
    expect(limiter.consume('user:reserve', 3, 60_000)).toBe(false);
  });

  it('resets the window after ttl expires', () => {
    jest.useFakeTimers();

    const limiter = new InMemoryRateLimiterService();
    expect(limiter.consume('user:confirm', 1, 1_000)).toBe(true);
    expect(limiter.consume('user:confirm', 1, 1_000)).toBe(false);

    jest.advanceTimersByTime(1_001);

    expect(limiter.consume('user:confirm', 1, 1_000)).toBe(true);

    jest.useRealTimers();
  });
});
