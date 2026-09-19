import { Injectable, Logger } from '@nestjs/common';
import { GameCategory, GameStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  cartelaPoolForCategory,
  liveCartelaPoolCategoryFilter,
} from './game-category.util';

export const LIVE_REGISTRATION_LOCK_STATUSES = [
  GameStatus.PLAYING,
  GameStatus.CHECKING,
  GameStatus.WINNER_WINDOW,
] as const;

export function isLiveRegistrationLockSourceStatus(
  status: GameStatus,
): boolean {
  return (LIVE_REGISTRATION_LOCK_STATUSES as readonly GameStatus[]).includes(
    status,
  );
}

interface CacheEntry {
  payload: unknown;
  expiresAtMs: number;
  generation: number;
}

interface SessionBucket {
  generation: number;
  entry?: CacheEntry;
  inFlight?: {
    promise: Promise<unknown>;
    generation: number;
  };
}

export interface RegistrationStateCacheLoadResult<T> {
  value: T;
  coalesced: boolean;
  loaderGeneration: number;
}

@Injectable()
export class RegistrationStateCacheService {
  static readonly TTL_MS = 400;

  private readonly logger = new Logger(RegistrationStateCacheService.name);
  private readonly buckets = new Map<string, SessionBucket>();

  private getOrCreateBucket(sessionId: string): SessionBucket {
    let bucket = this.buckets.get(sessionId);
    if (!bucket) {
      bucket = { generation: 0 };
      this.buckets.set(sessionId, bucket);
    }
    return bucket;
  }

  getGeneration(sessionId: string): number {
    return this.getOrCreateBucket(sessionId).generation;
  }

  read<T>(sessionId: string): T | null {
    const bucket = this.buckets.get(sessionId);
    if (!bucket?.entry) {
      this.logger.log(
        `[registration_state_cache] miss sessionId=${sessionId} reason=empty`,
      );
      return null;
    }

    if (Date.now() >= bucket.entry.expiresAtMs) {
      delete bucket.entry;
      this.logger.log(
        `[registration_state_cache] miss sessionId=${sessionId} reason=expired`,
      );
      return null;
    }

    if (bucket.entry.generation !== bucket.generation) {
      delete bucket.entry;
      this.logger.log(
        `[registration_state_cache] miss sessionId=${sessionId} reason=generation`,
      );
      return null;
    }

    this.logger.log(
      `[registration_state_cache] hit sessionId=${sessionId} generation=${bucket.generation}`,
    );
    return bucket.entry.payload as T;
  }

  write(sessionId: string, payload: unknown, loaderGeneration: number): boolean {
    const bucket = this.getOrCreateBucket(sessionId);
    if (loaderGeneration !== bucket.generation) {
      this.logger.log(
        `[registration_state_cache] skip_write sessionId=${sessionId} loaderGeneration=${loaderGeneration} currentGeneration=${bucket.generation}`,
      );
      return false;
    }

    bucket.entry = {
      payload,
      expiresAtMs: Date.now() + RegistrationStateCacheService.TTL_MS,
      generation: bucket.generation,
    };
    this.logger.log(
      `[registration_state_cache] store sessionId=${sessionId} ttlMs=${RegistrationStateCacheService.TTL_MS} generation=${bucket.generation}`,
    );
    return true;
  }

  invalidate(sessionId: string): void {
    const bucket = this.getOrCreateBucket(sessionId);
    bucket.generation += 1;
    delete bucket.entry;
    this.logger.log(
      `[registration_state_cache] invalidate sessionId=${sessionId} generation=${bucket.generation}`,
    );
  }

  async coalesce<T>(
    sessionId: string,
    loader: () => Promise<T>,
  ): Promise<RegistrationStateCacheLoadResult<T>> {
    const bucket = this.getOrCreateBucket(sessionId);
    const existing = bucket.inFlight;
    if (existing) {
      this.logger.log(
        `[registration_state_cache] coalesced sessionId=${sessionId} loaderGeneration=${existing.generation}`,
      );
      const value = (await existing.promise) as T;
      return {
        value,
        coalesced: true,
        loaderGeneration: existing.generation,
      };
    }

    const loaderGeneration = bucket.generation;
    let promise!: Promise<T>;

    promise = loader()
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        const current = this.buckets.get(sessionId);
        if (current?.inFlight?.promise === promise) {
          delete current.inFlight;
        }
      });

    bucket.inFlight = { promise, generation: loaderGeneration };

    try {
      const value = await promise;
      return { value, coalesced: false, loaderGeneration };
    } catch (error) {
      throw error;
    }
  }

  async load<T>(
    sessionId: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = this.read<T>(sessionId);
    if (cached) {
      return cached;
    }

    const { value, coalesced, loaderGeneration } = await this.coalesce(
      sessionId,
      loader,
    );
    if (!coalesced) {
      this.write(sessionId, value, loaderGeneration);
    }
    return value;
  }

  async invalidateReadySessionsInPool(
    prisma: PrismaService | Prisma.TransactionClient,
    category: GameCategory,
  ): Promise<void> {
    const poolCategoryFilter = liveCartelaPoolCategoryFilter(
      cartelaPoolForCategory(category),
    );
    const readySessions = await prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        gameSlot: { category: poolCategoryFilter },
      },
      select: { id: true },
    });

    for (const { id } of readySessions) {
      this.invalidate(id);
    }
  }
}
