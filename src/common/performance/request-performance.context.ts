import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

export type PerformanceUserRole = UserRole | 'guest';

export interface PrismaQueryRecord {
  model: string;
  operation: string;
  durationMs: number;
}

export interface PerformanceRunContext {
  operation: string;
  userRole: PerformanceUserRole;
}

export interface PerformanceMeasureResult {
  payloadBytes?: number;
  registeredCartelasSummaryCount?: number;
  [key: string]: unknown;
}

interface PerformanceState {
  context: PerformanceRunContext;
  queries: PrismaQueryRecord[];
  startedAt: number;
}

@Injectable()
export class RequestPerformanceContext {
  private readonly storage = new AsyncLocalStorage<PerformanceState>();
  private readonly logger = new Logger('Performance');

  run<T>(
    context: PerformanceRunContext,
    fn: () => Promise<T>,
    measureResult?: (result: T) => PerformanceMeasureResult,
  ): Promise<T> {
    const state: PerformanceState = {
      context,
      queries: [],
      startedAt: performance.now(),
    };

    return this.storage.run(state, async () => {
      try {
        const result = await fn();
        this.logCompletion(state, result, measureResult);
        return result;
      } catch (error) {
        this.logCompletion(state, undefined, undefined, error);
        throw error;
      }
    });
  }

  recordQuery(record: PrismaQueryRecord): void {
    const state = this.storage.getStore();
    if (state) {
      state.queries.push(record);
    }
  }

  private logCompletion(
    state: PerformanceState,
    result?: unknown,
    measureResult?: (result: unknown) => PerformanceMeasureResult,
    error?: unknown,
  ): void {
    const totalMs = Math.round(performance.now() - state.startedAt);
    const queries = state.queries;
    const queryCount = queries.length;
    const slowest =
      queries.length > 0
        ? queries.reduce((max, query) =>
            query.durationMs > max.durationMs ? query : max,
          )
        : { model: 'none', operation: 'none', durationMs: 0 };

    const extras =
      result !== undefined && measureResult
        ? measureResult(result)
        : ({} as PerformanceMeasureResult);

    const payloadBytes =
      typeof extras.payloadBytes === 'number'
        ? extras.payloadBytes
        : result !== undefined
          ? Buffer.byteLength(JSON.stringify(result), 'utf8')
          : 0;

    const { operation, userRole } = state.context;
    const status = error ? 'error' : 'ok';
    const extraFields = Object.entries(extras)
      .filter(([key]) => key !== 'payloadBytes')
      .map(([key, value]) => ` ${key}=${value}`)
      .join('');

    this.logger.log(
      `[perf] ${operation} status=${status} role=${userRole} durationMs=${totalMs} queryCount=${queryCount} slowestQuery=${slowest.model}.${slowest.operation}(${Math.round(slowest.durationMs)}ms) payloadBytes=${payloadBytes}${extraFields}`,
    );
  }
}

export function resolvePerformanceRole(
  userId?: string,
  role?: UserRole,
): PerformanceUserRole {
  if (!userId) {
    return 'guest';
  }

  return role ?? UserRole.PLAYER;
}

export function countOperationsSummaryItems(result: {
  liveGame?: { registeredCartelasSummary?: unknown[] } | null;
  registrationOpenGame?: { registeredCartelasSummary?: unknown[] } | null;
}): number {
  const liveCount = result.liveGame?.registeredCartelasSummary?.length ?? 0;
  const registrationCount =
    result.registrationOpenGame?.registeredCartelasSummary?.length ?? 0;

  return liveCount + registrationCount;
}
