import { Injectable } from '@nestjs/common';

@Injectable()
export class OperationsCacheService {
  static readonly TTL_MS = 500;

  private cache: {
    cacheKey: string;
    payload: unknown;
    expiresAtMs: number;
  } | null = null;

  read<T>(cacheKey: string): T | null {
    if (!this.cache || this.cache.cacheKey !== cacheKey) {
      return null;
    }

    if (Date.now() >= this.cache.expiresAtMs) {
      this.cache = null;
      return null;
    }

    return this.cache.payload as T;
  }

  write(cacheKey: string, payload: unknown): void {
    this.cache = {
      cacheKey,
      payload,
      expiresAtMs: Date.now() + OperationsCacheService.TTL_MS,
    };
  }

  invalidate(): void {
    this.cache = null;
  }
}
