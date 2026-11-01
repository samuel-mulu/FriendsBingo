import { InMemoryRateLimiterService } from './in-memory-rate-limiter.service';

describe('InMemoryRateLimiterService', () => {
  let limiter: InMemoryRateLimiterService;

  beforeEach(() => {
    limiter = new InMemoryRateLimiterService();
  });

  afterEach(() => {
    limiter.clearForTests();
  });

  it('allows requests within limit and rejects once exceeded', () => {
    const key = 'test-action:user-1';
    expect(limiter.consume(key, 2, 1000)).toBe(true);
    expect(limiter.consume(key, 2, 1000)).toBe(true);
    expect(limiter.consume(key, 2, 1000)).toBe(false);
  });

  it('resets count after window expires', async () => {
    const key = 'test-action:user-2';
    expect(limiter.consume(key, 1, 50)).toBe(true);
    expect(limiter.consume(key, 1, 50)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(limiter.consume(key, 1, 50)).toBe(true);
  });

  it('prunes expired keys from the bucket map', async () => {
    limiter.consume('key-short', 5, 20);
    limiter.consume('key-long', 5, 5000);

    expect(limiter.size()).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 35));

    const pruned = limiter.pruneExpired();
    expect(pruned).toBe(1);
    expect(limiter.size()).toBe(1);
  });

  it('automatically triggers lazy sweep when bucket limit is reached', () => {
    // Fill with expired buckets
    const past = Date.now() - 5000;
    jest.spyOn(Date, 'now').mockReturnValue(past);
    for (let i = 0; i < 2001; i++) {
      limiter.consume(`batch-key-${i}`, 1, 100);
    }

    // Now restore time to present
    jest.spyOn(Date, 'now').mockRestore();

    expect(limiter.size()).toBeGreaterThanOrEqual(2000);

    // Consuming one more key now triggers maybePrune
    limiter.consume('trigger-key', 1, 1000);

    // Old expired keys should have been pruned away
    expect(limiter.size()).toBeLessThan(10);
  });
});
