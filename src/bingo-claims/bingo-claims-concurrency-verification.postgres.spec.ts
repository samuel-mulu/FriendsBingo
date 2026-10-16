import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BingoClaimStatus,
  GameCategory,
  GameStatus,
  PrismaClient,
  WalletTransactionType,
} from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { BigGameTicketService } from '../games/big-game-ticket.service';
import { ChainRoundService } from '../games/chain-round.service';
import { GameQueueService } from '../games/game-queue.service';
import { GameLifecycleDebugLogger } from '../games/game-lifecycle-debug-logger.service';
import { WalletService } from '../wallet/wallet.service';
import {
  AutoCallClaimLostError,
  CalledNumbersService,
} from '../called-numbers/called-numbers.service';
import { BingoClaimsService } from './bingo-claims.service';
import { BingoClaimSource } from './dto/bingo-claim-source';

/**
 * OPT-IN, DISPOSABLE POSTGRES ONLY. No .env / DATABASE_URL / DIRECT_URL fallback.
 * Provision with the existing prisma.verification.config.ts, then run:
 * npx jest bingo-claims-concurrency-verification.postgres.spec.ts --runInBand
 * BINGO_FENCING_TEST_DATABASE_URL must target 127.0.0.1:65439/stage2a_claim_fencing.
 *
 * Real acceptance, validation, automatic draw, finalization, wallet and ledger.
 * Transport, pushes, deferred structural reads and opening the NEXT game are
 * excluded. Deterministic barriers exist ONLY here; production gains no locks,
 * queues, timers, instrumentation, or scheduling changes.
 *
 * Claim latency is service-call elapsed time (excludes HTTP/socket transport).
 * Transaction total includes pool acquisition, BEGIN, COMMIT/ROLLBACK; callback
 * time excludes acquisition/BEGIN. Lock-statement elapsed includes query and
 * transport overhead: it is NOT a pure lock-wait measurement. Actual blocked
 * waits come separately from pg_stat_activity / pg_locks, sampled at 5 ms plus
 * observer query time. Artificially held cases are labeled separately from load.
 */
const databaseUrl = process.env.BINGO_FENCING_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const poolSettings = { main: 12, competitor: 12, observer: 3 };
const samplingIntervalMs = 5;
const context = new AsyncLocalStorage<string>();
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function reached(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Verification barrier timed out')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
      : null;
  return {
    count: sorted.length,
    minMs: sorted[0] ?? null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
  };
}
type TxMetric = {
  request: string;
  totalMs: number;
  callbackMs: number;
  acquisitionAndBeginMs: number | null;
  committed: boolean;
};
type StatementMetric = { request: string; kind: string; elapsedMs: number };
type ClaimMetric = {
  request: string;
  scenario: string;
  cartelaId: string;
  userId: string;
  source: BingoClaimSource;
  latencyMs: number;
  status: string;
  reason: string | null;
  receiptCalledOrder?: number | null;
  error?: string;
};
type WaitSample = {
  atMs: number;
  pid: number;
  blockers: number[];
  wait_event: string;
  wait_ms: number | null;
  query: string;
};
type Hooks = {
  afterClaimLock?: (values: unknown[]) => Promise<void>;
  afterDrawInsert?: () => Promise<void>;
  afterAcceptance?: (accepted: any) => Promise<void>;
};

postgresDescribe(
  'automatic flow concurrency verification / 100 players, 1000 cartelas',
  () => {
    let db: PrismaClient;
    let competitorDb: PrismaClient;
    let mainPool: Pool;
    let competitorPool: Pool;
    let observer: Pool;
    let ruleId: string;
    let ownsRule = false;
    let version: string;
    const users = Array.from({ length: 100 }, () => randomUUID());
    const boards = Array.from({ length: 1000 }, () => randomUUID());
    const slots: string[] = [];
    const sessions: string[] = [];
    const transactions: TxMetric[] = [];
    const statements: StatementMetric[] = [];
    const claims: ClaimMetric[] = [];
    const waitSamples: WaitSample[] = [];
    const sampleCadence: number[] = [];
    const scenarioReports: Array<Record<string, unknown>> = [];
    const winnerEvents: Array<{
      request: string;
      sessionId: string;
      cartelaId: string;
      event: string;
      atMs: number;
    }> = [];
    let requestSerial = 0;
    let stopSampling = false;
    let sampling: Promise<void> | undefined;
    let sampleError: unknown;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '65439' ||
        url.pathname !== '/stage2a_claim_fencing'
      ) {
        throw new Error('Refusing non-isolated verification database');
      }
      mainPool = new Pool({
        connectionString: databaseUrl,
        max: poolSettings.main,
        application_name: 'friends-reliability-main',
      });
      competitorPool = new Pool({
        connectionString: databaseUrl,
        max: poolSettings.competitor,
        application_name: 'friends-reliability-competitor',
      });
      observer = new Pool({
        connectionString: databaseUrl,
        max: poolSettings.observer,
        application_name: 'friends-reliability-observer',
      });
      db = new PrismaClient({ adapter: new PrismaPg(mainPool) });
      competitorDb = new PrismaClient({
        adapter: new PrismaPg(competitorPool),
      });
      await Promise.all([db.$connect(), competitorDb.$connect()]);
      version = (await observer.query('SELECT version()')).rows[0].version;
      const existingRule = await db.gameRule.findUnique({
        where: { key: 'ONE_LINE' },
      });
      ownsRule = !existingRule;
      ruleId =
        existingRule?.id ??
        (
          await db.gameRule.create({
            data: { key: 'ONE_LINE', name: 'One line', sortOrder: 1 },
          })
        ).id;
      await db.user.createMany({
        data: users.map((id, index) => ({
          id,
          fullName: `Synthetic reliability player ${index}`,
          phoneNumber: `synthetic-${id}`,
          autoBingoGranted: true,
          autoBingoEnabled: true,
        })),
      });
      await db.wallet.createMany({
        data: users.map((userId) => ({ userId, balance: 1000 })),
      });
      const last = await db.cartela.aggregate({ _max: { number: true } });
      const startNumber = (last._max.number ?? 0) + 1;
      await db.cartela.createMany({
        data: boards.map((id, index) => ({
          id,
          number: startNumber + index,
          // Exactly seven templates complete on call 5. All other boards stay incomplete.
          b: index < 7 ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6],
          i: index < 7 ? [16, 17, 18, 19, 20] : [17, 18, 19, 20, 21],
          n: index < 7 ? [31, 32, 'FREE', 34, 35] : [32, 33, 'FREE', 35, 36],
          g: index < 7 ? [46, 47, 48, 49, 50] : [47, 48, 49, 50, 51],
          o: index < 7 ? [61, 62, 63, 64, 65] : [62, 63, 64, 65, 66],
        })),
      });
      sampling = sampleLocks().catch((error) => {
        sampleError = error;
      });
    }, 60_000);

    afterEach(() => jest.restoreAllMocks());

    afterAll(async () => {
      stopSampling = true;
      await sampling;
      console.log(
        'AUTO_FLOW_CONCURRENCY_REPORT',
        JSON.stringify(
          {
            database: '127.0.0.1:65439/stage2a_claim_fencing',
            version,
            poolSettings,
            fixture: {
              syntheticPlayers: 100,
              registeredCartelasPerSession: 1000,
            },
            notes: [
              'Service latency excludes network transport.',
              'Session statement elapsed includes query/transport overhead.',
              'Wait samples are server-observed, not per-request percentiles.',
              'Barrier scenarios are artificial holds; assess normal load separately.',
            ],
            requestedSampleIntervalMs: samplingIntervalMs,
            actualSampleCadence: distribution(sampleCadence),
            samplerError: sampleError ? String(sampleError) : null,
            sampledServerWait: distribution(
              waitSamples.flatMap((sample) =>
                sample.wait_ms == null ? [] : [Number(sample.wait_ms)],
              ),
            ),
            lockObservations: waitSamples,
            scenarios: scenarioReports,
            requests: claims,
            transactions,
            sessionStatements: statements,
            winnerEvents,
          },
          null,
          2,
        ),
      );
      if (!db) return;
      try {
        await db.auditLog.deleteMany({
          where: {
            OR: [{ actorId: { in: users } }, { entityId: { in: sessions } }],
          },
        });
        await db.walletTransaction.deleteMany({
          where: { userId: { in: users } },
        });
        await db.gameSession.deleteMany({ where: { id: { in: sessions } } });
        await db.gameSlot.deleteMany({ where: { id: { in: slots } } });
        await db.cartela.deleteMany({ where: { id: { in: boards } } });
        await db.user.deleteMany({ where: { id: { in: users } } });
        if (ownsRule && ruleId)
          await db.gameRule.delete({ where: { id: ruleId } });
      } finally {
        await Promise.all([db.$disconnect(), competitorDb.$disconnect()]);
        await Promise.all([
          mainPool.end(),
          competitorPool.end(),
          observer.end(),
        ]);
      }
      if (sampleError) throw sampleError;
    }, 60_000);

    async function sampleLocks() {
      let previous = performance.now();
      while (!stopSampling) {
        const atMs = performance.now();
        sampleCadence.push(atMs - previous);
        previous = atMs;
        const result = await observer.query(`
        SELECT a.pid, a.wait_event, a.query, pg_blocking_pids(a.pid) AS blockers,
          EXTRACT(EPOCH FROM (clock_timestamp() - MIN(l.waitstart))) * 1000 AS wait_ms
        FROM pg_stat_activity a
        LEFT JOIN pg_locks l ON l.pid = a.pid AND NOT l.granted
        WHERE a.application_name IN ('friends-reliability-main', 'friends-reliability-competitor')
          AND a.wait_event_type = 'Lock'
        GROUP BY a.pid, a.wait_event, a.query
      `);
        for (const row of result.rows)
          waitSamples.push({
            ...row,
            atMs,
            wait_ms: row.wait_ms == null ? null : Number(row.wait_ms),
          });
        await delay(samplingIntervalMs);
      }
    }

    function instrument(client: PrismaClient, hooks: Hooks = {}) {
      return new Proxy(client, {
        get(target, prop) {
          if (prop === '$transaction')
            return async (fn: any, options: any) => {
              const request = context.getStore() ?? 'fixture';
              const start = performance.now();
              let callbackStart: number | null = null;
              let callbackMs = 0;
              let committed = false;
              let result: any;
              try {
                result = await target.$transaction(async (tx) => {
                  callbackStart = performance.now();
                  const bodyStartedAt = callbackStart;
                  const wrapped = new Proxy(tx, {
                    get(transaction, key) {
                      if (key === '$queryRaw')
                        return async (...args: any[]) => {
                          const sql = Array.isArray(args[0])
                            ? args[0].join('')
                            : (args[0]?.strings?.join('') ?? '');
                          const before = performance.now();
                          try {
                            const rows = await (transaction.$queryRaw as any)(
                              ...args,
                            );
                            if (
                              sql.includes('"BingoClaim"') &&
                              sql.includes('FOR UPDATE')
                            ) {
                              await hooks.afterClaimLock?.(args.slice(1));
                            }
                            return rows;
                          } finally {
                            if (
                              sql.includes('"GameSession"') &&
                              sql.includes('FOR UPDATE')
                            ) {
                              statements.push({
                                request,
                                kind: 'session_select_for_update',
                                elapsedMs: performance.now() - before,
                              });
                            }
                          }
                        };
                      if (key === 'gameSession')
                        return new Proxy(transaction.gameSession, {
                          get(delegate, method) {
                            if (method === 'updateMany')
                              return async (args: any) => {
                                const before = performance.now();
                                try {
                                  return await delegate.updateMany(args);
                                } finally {
                                  statements.push({
                                    request,
                                    kind: 'session_conditional_update',
                                    elapsedMs: performance.now() - before,
                                  });
                                }
                              };
                            const value = Reflect.get(delegate, method);
                            return typeof value === 'function'
                              ? value.bind(delegate)
                              : value;
                          },
                        });
                      if (key === 'calledNumber')
                        return new Proxy(transaction.calledNumber, {
                          get(delegate, method) {
                            if (method === 'create')
                              return async (args: any) => {
                                const result = await delegate.create(args);
                                await hooks.afterDrawInsert?.();
                                return result;
                              };
                            const value = Reflect.get(delegate, method);
                            return typeof value === 'function'
                              ? value.bind(delegate)
                              : value;
                          },
                        });
                      const value = Reflect.get(transaction, key);
                      return typeof value === 'function'
                        ? value.bind(transaction)
                        : value;
                    },
                  });
                  try {
                    return await fn(wrapped);
                  } finally {
                    callbackMs = performance.now() - bodyStartedAt;
                  }
                }, options);
                committed = true;
              } finally {
                transactions.push({
                  request,
                  committed,
                  callbackMs,
                  acquisitionAndBeginMs:
                    callbackStart === null ? null : callbackStart - start,
                  totalMs: performance.now() - start,
                });
              }
              if (result?.kind === 'auto_checking')
                await hooks.afterAcceptance?.(result);
              return result;
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }

    function services(client: PrismaClient, hooks: Hooks = {}) {
      const measured = instrument(client, hooks);
      const audit = new AuditLogService();
      const realtime = {
        emitToGame: jest.fn(
          (sessionId: string, event: string, payload: any) => {
            if (
              event === 'game:winner_window_started' ||
              event === 'game:winner_window_joined'
            ) {
              winnerEvents.push({
                request: context.getStore() ?? 'verification',
                sessionId,
                cartelaId: payload.gameCartelaId,
                event,
                atMs: performance.now(),
              });
            }
          },
        ),
        emitToUser: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      };
      const tickets = new BigGameTicketService(measured as never);
      const wallet = new WalletService(measured as never, tickets);
      const perf = { run: (_ctx: unknown, fn: () => any) => fn() };
      const claimsService = new BingoClaimsService(
        measured as never,
        { emitSessionFinished: jest.fn() } as never,
        new GameRuleEvaluationService(),
        realtime as never,
        audit,
        wallet,
        new GameQueueService(new GameLifecycleDebugLogger()),
        perf as never,
        {
          getAutoCallIntervalMs: async () => 3000,
          getWinnerWindowDurationMs: async () => 25_000,
          getWinnerWindowClaimGraceMs: async () => 1000,
        } as never,
        { invalidate: jest.fn() } as never,
        {
          openNextAutoQueueRegistrationInTransaction: async () => null,
          finalizeOpenedRegistration: async () => undefined,
        } as never,
        {} as never,
        tickets,
        {} as never,
        new ChainRoundService(measured as never, realtime as never),
        {
          getRequestIdForLog: () => context.getStore() ?? 'verification',
        } as never,
      );
      jest
        .spyOn(claimsService as any, 'runDeferredClaimStructuralRefresh')
        .mockResolvedValue(undefined);
      jest
        .spyOn(claimsService as any, 'notifyWinnerWindowPush')
        .mockResolvedValue(undefined);
      jest
        .spyOn((claimsService as any).logger, 'log')
        .mockImplementation(() => undefined);
      const numbers = new CalledNumbersService(
        measured as never,
        realtime as never,
        audit,
        perf as never,
        {} as never,
      );
      return { claims: claimsService, numbers, audit, hooks };
    }

    async function fixture(sameOwner = false, calledCount = 5) {
      const slotId = randomUUID();
      const sessionId = randomUUID();
      slots.push(slotId);
      sessions.push(sessionId);
      await db.gameSlot.create({
        data: {
          id: slotId,
          staticCode: `VERIFY-${slotId}`,
          name: 'Synthetic automatic-flow verification',
          category: GameCategory.NORMAL,
          gameType: 'ONE_LINE',
          gameRuleId: ruleId,
          status: GameStatus.PLAYING,
          removeAfterFinish: true,
        },
      });
      await db.gameSession.create({
        data: {
          id: sessionId,
          gameSlotId: slotId,
          gameRuleId: ruleId,
          playCode: `VERIFY-${sessionId}`,
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
          autoCallIntervalMs: 3000,
          nextAutoCallAt: new Date(Date.now() - 10),
          prizeAmount: 100,
        },
      });
      const cards = boards.map((cartelaId, index) => ({
        id: randomUUID(),
        cartelaId,
        gameSessionId: sessionId,
        userId: users[sameOwner ? Math.floor(index / 10) : index % 100],
      }));
      await db.gameCartela.createMany({ data: cards });
      await db.calledNumber.createMany({
        data: [1, 16, 31, 46, 61]
          .slice(0, calledCount)
          .map((number, index) => ({
            gameSessionId: sessionId,
            letter: ['B', 'I', 'N', 'G', 'O'][index],
            number,
            order: index + 1,
          })),
      });
      expect(
        await db.gameCartela.count({ where: { gameSessionId: sessionId } }),
      ).toBe(1000);
      expect(new Set(cards.map((card) => card.userId)).size).toBe(100);
      return { sessionId, cards };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    type Services = ReturnType<typeof services>;
    async function post(
      label: string,
      f: Fixture,
      index: number,
      s: Services,
      source = BingoClaimSource.MANUAL,
      uuid = randomUUID(),
    ) {
      const card = f.cards[index];
      const request = `${label}/${uuid}/${++requestSerial}`;
      return context.run(request, async () => {
        const before = performance.now();
        try {
          const result = (await s.claims.claimBingo(f.sessionId, card.userId, {
            gameCartelaId: card.id,
            claimAttemptId: uuid,
            claimSource: source,
          })) as any;
          claims.push({
            request,
            scenario: label,
            cartelaId: card.id,
            userId: card.userId,
            source,
            latencyMs: performance.now() - before,
            status: result.claim.status,
            reason: result.reasonCode ?? result.failureCode ?? null,
            receiptCalledOrder: result.claim.receiptCalledOrder,
          });
          return result;
        } catch (error) {
          claims.push({
            request,
            scenario: label,
            cartelaId: card.id,
            userId: card.userId,
            source,
            latencyMs: performance.now() - before,
            status: 'ERROR',
            reason: null,
            error: String(error),
          });
          throw error;
        }
      });
    }

    async function scenario(label: string, action: () => Promise<void>) {
      const before = performance.now();
      try {
        await action();
      } finally {
        const rows = claims.filter((row) => row.scenario === label);
        const tx = transactions.filter((row) =>
          row.request.startsWith(`${label}/`),
        );
        const sql = statements.filter((row) =>
          row.request.startsWith(`${label}/`),
        );
        const exclusions: Record<string, number> = {};
        const events = winnerEvents.filter((row) =>
          row.request.startsWith(`${label}/`),
        );
        const observedWaits = waitSamples.filter((row) => row.atMs >= before);
        for (const row of rows) {
          const reason = `${row.status}:${row.reason ?? row.error ?? '-'}`;
          exclusions[reason] = (exclusions[reason] ?? 0) + 1;
        }
        scenarioReports.push({
          label,
          elapsedMs: performance.now() - before,
          serviceClaimLatency: distribution(rows.map((row) => row.latencyMs)),
          transactionElapsed: distribution(tx.map((row) => row.totalMs)),
          transactionCallback: distribution(tx.map((row) => row.callbackMs)),
          sessionLockStatementElapsedWithOverhead: distribution(
            sql
              .filter((row) => row.kind === 'session_select_for_update')
              .map((row) => row.elapsedMs),
          ),
          conditionalSessionUpdateElapsedWithOverhead: distribution(
            sql
              .filter((row) => row.kind === 'session_conditional_update')
              .map((row) => row.elapsedMs),
          ),
          transactionRollbacks: tx.filter((row) => !row.committed).length,
          outcomesAndExclusionReasons: exclusions,
          multipleWinnerProcessing: {
            winners: rows
              .filter((row) => row.status === BingoClaimStatus.VALID)
              .map((row) => ({
                cartelaId: row.cartelaId,
                userId: row.userId,
                source: row.source,
                latencyMs: row.latencyMs,
              })),
            windowOpenedEvents: events.filter(
              (row) => row.event === 'game:winner_window_started',
            ).length,
            windowJoinedEvents: events.filter(
              (row) => row.event === 'game:winner_window_joined',
            ).length,
            firstOpenToLastJoinMs:
              events.length > 1 ? events.at(-1)!.atMs - events[0].atMs : null,
          },
          observedBlockedSamples: observedWaits.length,
          sampledServerWait: distribution(
            observedWaits.flatMap((row) =>
              row.wait_ms == null ? [] : [row.wait_ms],
            ),
          ),
        });
      }
    }

    async function observedBlocking(since: number) {
      const until = performance.now() + 4000;
      while (performance.now() < until) {
        if (sampleError) throw sampleError;
        if (
          waitSamples.some(
            (row) => row.atMs >= since && row.blockers.length > 0,
          )
        )
          return;
        await delay(samplingIntervalMs);
      }
      throw new Error(
        'No PostgreSQL blocking observed within the sampling deadline',
      );
    }
    function draw(s: Services, sessionId: string, number: number) {
      jest
        .spyOn(s.numbers as any, 'queryRandomRemainingNumber')
        .mockResolvedValue({
          number,
          remainingCount: 70,
        });
      return s.numbers.callRandomNumberForAutoCall(sessionId, {
        intervalMs: 3000,
        scheduledDueAt: new Date(Date.now() - 10),
        nextAutoCallAt: new Date(Date.now() + 3000),
      });
    }

    async function settleExactlyOnce(
      label: string,
      f: Fixture,
      winners: number[],
    ) {
      const before = await db.wallet.findMany({
        where: { userId: { in: users } },
      });
      await db.gameSession.update({
        where: { id: f.sessionId },
        data: { winnerWindowEndsAt: new Date(Date.now() - 2000) },
      });
      const a = services(db),
        b = services(competitorDb);
      const results = await Promise.all([
        context.run(`${label}/settle-A`, () =>
          a.claims.finalizeWinnerWindow(f.sessionId),
        ),
        context.run(`${label}/settle-B`, () =>
          b.claims.finalizeWinnerWindow(f.sessionId),
        ),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const ledger = await db.walletTransaction.findMany({
        where: {
          type: WalletTransactionType.PRIZE_WIN,
          referenceType: 'GAME_CARTELA',
          referenceId: { in: f.cards.map((card) => card.id) },
        },
      });
      expect(ledger).toHaveLength(winners.length);
      expect(new Set(ledger.map((row) => row.referenceId))).toEqual(
        new Set(winners.map((index) => f.cards[index].id)),
      );
      expect(
        ledger.reduce((sum, row) => sum + Number(row.amount), 0),
      ).toBeCloseTo(100, 8);
      const after = await db.wallet.findMany({
        where: { userId: { in: users } },
      });
      for (const wallet of after) {
        const initial = before.find((row) => row.userId === wallet.userId)!;
        const paid = ledger
          .filter((row) => row.userId === wallet.userId)
          .reduce((sum, row) => sum + Number(row.amount), 0);
        expect(Number(wallet.balance) - Number(initial.balance)).toBeCloseTo(
          paid,
          8,
        );
        expect(wallet.lockedBalance.toString()).toBe(
          initial.lockedBalance.toString(),
        );
        const chain = ledger
          .filter((row) => row.userId === wallet.userId)
          .sort((a, b) => Number(a.balanceBefore) - Number(b.balanceBefore));
        let balance = Number(initial.balance);
        for (const row of chain) {
          expect(Number(row.balanceBefore)).toBeCloseTo(balance, 8);
          balance += Number(row.amount);
          expect(Number(row.balanceAfter)).toBeCloseTo(balance, 8);
        }
      }
      expect(
        (await db.gameSession.findUniqueOrThrow({ where: { id: f.sessionId } }))
          .status,
      ).toBe(GameStatus.FINISHED);
      scenarioReports.push({
        label: `${label}/settlement`,
        creditedRows: ledger.length,
        creditedTotal: ledger.reduce((sum, row) => sum + Number(row.amount), 0),
        distinctPaidPlayers: new Set(ledger.map((row) => row.userId)).size,
        successfulFinalizers: results.filter(Boolean).length,
      });
    }

    it('100 simultaneous button/AUTO claims; seven winners across players; exactly-once settlement', async () => {
      const label = 'normal-load-100-mixed-claims';
      await scenario(label, async () => {
        const f = await fixture();
        const s = services(db);
        const results = await Promise.allSettled(
          Array.from({ length: 100 }, (_, index) =>
            post(
              label,
              f,
              index,
              s,
              index % 2 ? BingoClaimSource.AUTO : BingoClaimSource.MANUAL,
            ),
          ),
        );
        expect(results.filter((row) => row.status === 'rejected')).toHaveLength(
          0,
        );
        const responses = results.flatMap((row) =>
          row.status === 'fulfilled' ? [row.value] : [],
        );
        expect(
          responses.filter(
            (row) => row.claim.status === BingoClaimStatus.VALID,
          ),
        ).toHaveLength(7);
        expect(
          responses.filter(
            (row) => row.claim.status === BingoClaimStatus.INVALID,
          ),
        ).toHaveLength(93);
        expect(
          responses
            .slice(0, 7)
            .every((row) => row.claim.receiptCalledOrder === 5),
        ).toBe(true);
        await settleExactlyOnce(label, f, [0, 1, 2, 3, 4, 5, 6]);
      });
    }, 120_000);

    it('seven same-ball cartelas owned by one player all join and settle once', async () => {
      const label = 'seven-cartelas-one-player';
      await scenario(label, async () => {
        const f = await fixture(true),
          s = services(db);
        const results = await Promise.all(
          Array.from({ length: 7 }, (_, index) =>
            post(
              label,
              f,
              index,
              s,
              index % 2 ? BingoClaimSource.AUTO : BingoClaimSource.MANUAL,
            ),
          ),
        );
        expect(
          results.every((row) => row.claim.status === BingoClaimStatus.VALID),
        ).toBe(true);
        expect(
          new Set(f.cards.slice(0, 7).map((card) => card.userId)).size,
        ).toBe(1);
        await settleExactlyOnce(label, f, [0, 1, 2, 3, 4, 5, 6]);
      });
    }, 60_000);

    it('draw commits before overlapping acceptance and is included in receipt', async () => {
      const label = 'barrier-draw-before-acceptance';
      await scenario(label, async () => {
        const f = await fixture(false, 4);
        const inserted = barrier(),
          release = barrier();
        const drawing = services(competitorDb, {
          afterDrawInsert: async () => {
            inserted.release();
            await release.promise;
          },
        });
        const started = performance.now();
        const drawingPromise = context.run(`${label}/draw`, () =>
          draw(drawing, f.sessionId, 61),
        );
        let claiming: ReturnType<typeof post> | undefined;
        try {
          await reached(inserted.promise);
          claiming = post(label, f, 0, services(db), BingoClaimSource.AUTO);
          await observedBlocking(started);
        } finally {
          release.release();
          await drawingPromise;
        }
        const result = await claiming!;
        expect(result.claim.status).toBe(BingoClaimStatus.VALID);
        expect(result.claim.receiptCalledOrder).toBe(5);
      });
    }, 60_000);

    it('accepted pause prevents the competing automatic draw from committing', async () => {
      const label = 'barrier-acceptance-before-draw';
      await scenario(label, async () => {
        const f = await fixture();
        const accepted = barrier(),
          release = barrier();
        const s = services(db, {
          afterAcceptance: async () => {
            accepted.release();
            await release.promise;
          },
        });
        const claiming = post(label, f, 0, s);
        try {
          await reached(accepted.promise);
          await expect(
            context.run(`${label}/draw`, () =>
              draw(services(competitorDb), f.sessionId, 2),
            ),
          ).rejects.toBeInstanceOf(AutoCallClaimLostError);
          expect(
            await db.calledNumber.count({
              where: { gameSessionId: f.sessionId },
            }),
          ).toBe(5);
        } finally {
          release.release();
        }
        expect((await claiming).claim.receiptCalledOrder).toBe(5);
      });
    }, 60_000);

    it('slow validation exposes actual PostgreSQL session-lock waiting, then both winners join', async () => {
      const label = 'barrier-slow-validation';
      await scenario(label, async () => {
        const f = await fixture();
        const held = barrier(),
          release = barrier();
        const s = services(db, {
          afterClaimLock: async () => {
            held.release();
            await release.promise;
          },
        });
        const first = post(label, f, 0, s);
        let second: ReturnType<typeof post> | undefined;
        const start = performance.now();
        try {
          await reached(held.promise);
          second = post(
            label,
            f,
            1,
            services(competitorDb),
            BingoClaimSource.AUTO,
          );
          await observedBlocking(start);
        } finally {
          release.release();
        }
        const responses = await Promise.all([first, second!]);
        expect(
          responses.every((row) => row.claim.status === BingoClaimStatus.VALID),
        ).toBe(true);
      });
    }, 60_000);

    it('technical rollback finalizes FAILED, resumes calling and preserves later late-claim rejection', async () => {
      const label = 'technical-failure-resume';
      await scenario(label, async () => {
        const f = await fixture(),
          s = services(db);
        const original = s.audit.create.bind(s.audit);
        jest.spyOn(s.audit, 'create').mockImplementation(async (tx, input) => {
          await original(tx, input);
          if (input.action === 'player.bingo.winner_window.opened') {
            throw new Error('synthetic validation rollback');
          }
        });
        const failed = await post(label, f, 0, s, BingoClaimSource.AUTO);
        expect(failed.claim.status).toBe(BingoClaimStatus.FAILED);
        expect(failed.retryAllowed).toBe(true);
        const current = await db.gameSession.findUniqueOrThrow({
          where: { id: f.sessionId },
        });
        expect(current.status).toBe(GameStatus.PLAYING);
        expect(current.nextAutoCallAt).not.toBeNull();
        expect(
          (
            await db.gameCartela.findUniqueOrThrow({
              where: { id: f.cards[0].id },
            })
          ).status,
        ).toBe('REGISTERED');
        await db.gameSession.update({
          where: { id: f.sessionId },
          data: { nextAutoCallAt: new Date(Date.now() - 10) },
        });
        const competingDraws = await Promise.allSettled([
          context.run(`${label}/resumed-draw-A`, () =>
            draw(services(db), f.sessionId, 2),
          ),
          context.run(`${label}/resumed-draw-B`, () =>
            draw(services(competitorDb), f.sessionId, 2),
          ),
        ]);
        expect(
          competingDraws.filter((row) => row.status === 'fulfilled'),
        ).toHaveLength(1);
        const lost = competingDraws.find((row) => row.status === 'rejected');
        expect(lost?.status === 'rejected' ? lost.reason : null).toBeInstanceOf(
          AutoCallClaimLostError,
        );
        expect(
          await db.calledNumber.count({
            where: { gameSessionId: f.sessionId },
          }),
        ).toBe(6);
        const late = await post(label, f, 1, services(db));
        expect(late.claim.status).toBe(BingoClaimStatus.INVALID);
        expect(late.reasonCode).toBe('INVALID_LATE_CLAIM');
      });
    }, 60_000);

    it('same UUID races and recovery GET preserve one claim, one winner and one payout', async () => {
      const label = 'duplicate-uuid-and-recovery';
      await scenario(label, async () => {
        const f = await fixture(),
          uuid = randomUUID();
        const results = await Promise.all([
          post(label, f, 0, services(db), BingoClaimSource.AUTO, uuid),
          post(
            label,
            f,
            0,
            services(competitorDb),
            BingoClaimSource.AUTO,
            uuid,
          ),
        ]);
        expect(new Set(results.map((row) => row.claim.id)).size).toBe(1);
        expect(
          await db.bingoClaim.count({ where: { claimAttemptId: uuid } }),
        ).toBe(1);
        // Simulate losing HTTP delivery and reconnecting via the existing GET.
        const recovered = await services(db).claims.getPlayerBingoClaimAttempt(
          f.sessionId,
          f.cards[0].userId,
          uuid,
        );
        expect(recovered.status).toBe(BingoClaimStatus.VALID);
        expect(recovered.claimAttemptId).toBe(uuid);
        const duplicate = await post(
          label,
          f,
          0,
          services(db),
          BingoClaimSource.AUTO,
          uuid,
        );
        expect(duplicate.claim.status).toBe(BingoClaimStatus.VALID);
        await settleExactlyOnce(label, f, [0]);
      });
    }, 60_000);

    it('a claim accepted before deadline cannot extend an expired winner window', async () => {
      const label = 'barrier-winner-window-expiry';
      await scenario(label, async () => {
        const f = await fixture();
        await post(label, f, 0, services(db));
        const accepted = barrier(),
          release = barrier();
        const claiming = post(
          label,
          f,
          1,
          services(db, {
            afterAcceptance: async () => {
              accepted.release();
              await release.promise;
            },
          }),
          BingoClaimSource.AUTO,
        );
        try {
          await reached(accepted.promise);
          await db.gameSession.update({
            where: { id: f.sessionId },
            data: { winnerWindowEndsAt: new Date(Date.now() - 2000) },
          });
        } finally {
          release.release();
        }
        const expired = await claiming;
        expect(expired.claim.status).toBe(BingoClaimStatus.FAILED);
        expect(
          (
            await db.gameCartela.findUniqueOrThrow({
              where: { id: f.cards[1].id },
            })
          ).isWinner,
        ).toBe(false);
        await settleExactlyOnce(label, f, [0]);
      });
    }, 60_000);
  },
);
