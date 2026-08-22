import { Injectable, Logger } from '@nestjs/common';

export type OperationsCacheRoleKey = 'player' | 'admin';

interface CacheEntry {
  payload: unknown;
  expiresAtMs: number;
  generation: number;
}

interface InFlightEntry {
  promise: Promise<unknown>;
  generation: number;
}

export interface OperationsCacheLoadResult<T> {
  value: T;
  coalesced: boolean;
  loaderGeneration: number;
}

@Injectable()
export class OperationsCacheService {
  static readonly TTL_MS = 1000;

  private readonly logger = new Logger(OperationsCacheService.name);
  private generation = 0;
  private readonly cache = new Map<OperationsCacheRoleKey, CacheEntry>();
  private readonly inFlight = new Map<
    OperationsCacheRoleKey,
    InFlightEntry
  >();

  getGeneration(): number {
    return this.generation;
  }

  read<T>(roleKey: OperationsCacheRoleKey): T | null {
    const entry = this.cache.get(roleKey);
    if (!entry) {
      this.logger.log(
        `[operations_cache] miss role=${roleKey} key=${roleKey} reason=empty`,
      );
      return null;
    }

    if (Date.now() >= entry.expiresAtMs) {
      this.cache.delete(roleKey);
      this.logger.log(
        `[operations_cache] miss role=${roleKey} key=${roleKey} reason=expired`,
      );
      return null;
    }

    if (entry.generation !== this.generation) {
      this.cache.delete(roleKey);
      this.logger.log(
        `[operations_cache] miss role=${roleKey} key=${roleKey} reason=generation`,
      );
      return null;
    }

    this.logger.log(
      `[operations_cache] hit role=${roleKey} key=${roleKey} ageMs=${Date.now() - (entry.expiresAtMs - OperationsCacheService.TTL_MS)}`,
    );
    return entry.payload as T;
  }

  write(
    roleKey: OperationsCacheRoleKey,
    payload: unknown,
    loaderGeneration: number,
  ): boolean {
    if (loaderGeneration !== this.generation) {
      this.logger.log(
        `[operations_cache] skip_write role=${roleKey} key=${roleKey} loaderGeneration=${loaderGeneration} currentGeneration=${this.generation}`,
      );
      return false;
    }

    this.cache.set(roleKey, {
      payload,
      expiresAtMs: Date.now() + OperationsCacheService.TTL_MS,
      generation: this.generation,
    });
    this.logger.log(
      `[operations_cache] store role=${roleKey} key=${roleKey} ttlMs=${OperationsCacheService.TTL_MS} generation=${this.generation}`,
    );
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.cache.clear();
    this.logger.log(
      `[operations_cache] invalidate generation=${this.generation}`,
    );
  }

  async coalesce<T>(
    roleKey: OperationsCacheRoleKey,
    loader: () => Promise<T>,
  ): Promise<OperationsCacheLoadResult<T>> {
    const existing = this.inFlight.get(roleKey);
    if (existing) {
      this.logger.log(
        `[operations_cache] coalesced role=${roleKey} key=${roleKey} loaderGeneration=${existing.generation}`,
      );
      const value = (await existing.promise) as T;
      return {
        value,
        coalesced: true,
        loaderGeneration: existing.generation,
      };
    }

    const loaderGeneration = this.generation;
    let promise!: Promise<T>;

    promise = loader()
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        const current = this.inFlight.get(roleKey);
        if (current?.promise === promise) {
          this.inFlight.delete(roleKey);
        }
      });

    this.inFlight.set(roleKey, { promise, generation: loaderGeneration });

    try {
      const value = await promise;
      return { value, coalesced: false, loaderGeneration };
    } catch (error) {
      throw error;
    }
  }
}
