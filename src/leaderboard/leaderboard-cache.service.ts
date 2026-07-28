import { Injectable } from '@nestjs/common';

@Injectable()
export class LeaderboardCacheService {
  static readonly TTL_MS = 60_000;

  private cache = new Map<
    string,
    {
      payload: unknown;
      expiresAtMs: number;
    }
  >();

  read<T>(cacheKey: string): T | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAtMs) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.payload as T;
  }

  write(cacheKey: string, payload: unknown): void {
    this.cache.set(cacheKey, {
      payload,
      expiresAtMs: Date.now() + LeaderboardCacheService.TTL_MS,
    });
  }

  invalidate(): void {
    this.cache.clear();
  }
}
