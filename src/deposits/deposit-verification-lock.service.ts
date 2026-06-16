import { Injectable } from '@nestjs/common';

const DEFAULT_LOCK_TTL_MS = 30_000;

@Injectable()
export class DepositVerificationLockService {
  private readonly locks = new Map<string, number>();

  tryAcquire(key: string, ttlMs = DEFAULT_LOCK_TTL_MS): boolean {
    this.cleanupExpired();

    const existingExpiresAt = this.locks.get(key);
    if (existingExpiresAt && existingExpiresAt > Date.now()) {
      return false;
    }

    this.locks.set(key, Date.now() + ttlMs);
    return true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.locks.entries()) {
      if (expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}
