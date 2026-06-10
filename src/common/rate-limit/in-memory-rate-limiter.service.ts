import { Injectable } from '@nestjs/common';

interface RateLimitBucket {
  count: number;
  windowStartMs: number;
}

@Injectable()
export class InMemoryRateLimiterService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStartMs >= windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: now });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  clearForTests(): void {
    this.buckets.clear();
  }
}
