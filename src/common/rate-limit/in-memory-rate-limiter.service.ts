import { Injectable } from '@nestjs/common';

interface RateLimitBucket {
  count: number;
  windowStartMs: number;
  expiresAtMs: number;
}

@Injectable()
export class InMemoryRateLimiterService {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private lastPrunedAtMs = 0;
  private static readonly PRUNE_INTERVAL_MS = 30_000;
  private static readonly MAX_BUCKETS_BEFORE_SWEEP = 2_000;

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.maybePrune(now);

    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.expiresAtMs) {
      this.buckets.set(key, {
        count: 1,
        windowStartMs: now,
        expiresAtMs: now + windowMs,
      });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  pruneExpired(now: number = Date.now()): number {
    let deletedCount = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.expiresAtMs) {
        this.buckets.delete(key);
        deletedCount++;
      }
    }
    this.lastPrunedAtMs = now;
    return deletedCount;
  }

  private maybePrune(now: number): void {
    if (
      this.buckets.size >= InMemoryRateLimiterService.MAX_BUCKETS_BEFORE_SWEEP ||
      now - this.lastPrunedAtMs >= InMemoryRateLimiterService.PRUNE_INTERVAL_MS
    ) {
      this.pruneExpired(now);
    }
  }

  size(): number {
    return this.buckets.size;
  }

  clearForTests(): void {
    this.buckets.clear();
    this.lastPrunedAtMs = 0;
  }
}
