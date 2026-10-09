import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { BingoClaimRecoveryService } from './bingo-claim-recovery.service';
import { ChainRoundService } from '../games/chain-round.service';
import { BigGameRoundService } from '../games/big-game-round.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameCategory,
  GameStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { serializePlayerBingoClaim } from './bingo-claims.mapper';
import { CreateBingoClaimDto } from './dto/create-bingo-claim.dto';
import {
  AutoCallClaimLostError,
  CalledNumbersService,
} from '../called-numbers/called-numbers.service';

// Explicit opt-in only. Never fall back to DATABASE_URL / DIRECT_URL or .env.
const databaseUrl = process.env.BINGO_FENCING_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const txnOptions = { maxWait: 10_000, timeout: 20_000 };
type ClaimResponse = {
  claim: ReturnType<typeof serializePlayerBingoClaim>;
  retryAllowed?: boolean;
  nextAutoCallAt?: string | null;
  winnerWindowEndsAt?: string;
};

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

postgresDescribe('Bingo claim fencing / isolated real PostgreSQL', () => {
  let db: PrismaClient;
  let otherDb: PrismaClient;
  let pool: Pool;
  let otherPool: Pool;
  let observer: Pool;
  let nextCardNumber = Date.now() % 1_000_000_000;
  const createdSlotIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdCartelaIds: string[] = [];
  const events: Array<{ event: string; payload: any }> = [];
  const committedEventChecks: Promise<void>[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '65439' ||
      url.pathname !== '/stage2a_claim_fencing'
    ) {
      throw new Error(
        'Refusing non-isolated database: use 127.0.0.1:65439/stage2a_claim_fencing',
      );
    }
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      application_name: 'stage2a-validator',
    });
    otherPool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      application_name: 'stage2a-competitor',
    });
    observer = new Pool({
      connectionString: databaseUrl,
      max: 3,
      application_name: 'stage2a-observer',
    });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    otherDb = new PrismaClient({ adapter: new PrismaPg(otherPool) });
    await Promise.all([db.$connect(), otherDb.$connect()]);
    console.log(
      'REAL_POSTGRES',
      (await observer.query('SELECT version()')).rows[0].version,
    );
    for (const key of ['ONE_LINE', 'MANUAL']) {
      await db.gameRule.upsert({
        where: { key },
        update: {},
        create: { key, name: key, sortOrder: 1 },
      });
    }
  }, 30_000);

  beforeEach(() => {
    events.length = 0;
    committedEventChecks.length = 0;
  });

  afterEach(async () => {
    await Promise.all(committedEventChecks);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (!db) return;
    // Only objects created by this suite, in the hard-guarded isolated database.
    await db.gameSession.deleteMany({
      where: { gameSlotId: { in: createdSlotIds } },
    });
    await db.gameSlot.deleteMany({ where: { id: { in: createdSlotIds } } });
    await db.auditLog.deleteMany({
      where: { actorId: { in: createdUserIds } },
    });
    await db.cartela.deleteMany({ where: { id: { in: createdCartelaIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
    await Promise.all([pool.end(), otherPool.end(), observer.end()]);
  });

  function service(client = db) {
    const evaluation = new GameRuleEvaluationService();
    const audit = new AuditLogService();
    const timing = {
      getAutoCallIntervalMs: jest.fn(async () => 3000),
      getWinnerWindowDurationMs: jest.fn(async () => 25_000),
      getWinnerWindowClaimGraceMs: jest.fn(async () => 1000),
    };
    const realtime = {
      emitToGame: jest.fn((_session: string, event: string, payload: any) => {
        events.push({ event, payload });
        const expected =
          event === 'game:bingo_claim_failed'
            ? BingoClaimStatus.FAILED
            : event === 'game:bingo_invalid'
              ? BingoClaimStatus.INVALID
              : event === 'game:winner_window_started' ||
                  event === 'game:winner_window_joined'
                ? BingoClaimStatus.VALID
                : null;
        if (expected) {
          committedEventChecks.push(
            otherDb.bingoClaim
              .findUniqueOrThrow({
                where: { id: payload.claimId },
              })
              .then((claim) => {
                expect(claim.status).toBe(expected);
              }),
          );
        }
      }),
      emitToAdmin: jest.fn(),
      emitToUser: jest.fn(),
      emitToSession: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };
    const performance = { run: (_context: unknown, fn: () => any) => fn() };
    const claims = new BingoClaimsService(
      client as never,
      {} as never,
      evaluation,
      realtime as never,
      audit,
      {} as never,
      {} as never,
      performance as never,
      timing as never,
      {} as never,
      {} as never,
      { notifyWinnerWindowStarted: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: () => 'stage2a-postgres-test' } as never,
    );
    // Exclude deferred structural/push traffic from the claim transaction tests.
    jest
      .spyOn(claims as any, 'runDeferredClaimStructuralRefresh')
      .mockResolvedValue(undefined);
    jest
      .spyOn(claims as any, 'notifyWinnerWindowPush')
      .mockResolvedValue(undefined);
    jest
      .spyOn((claims as any).logger, 'log')
      .mockImplementation(() => undefined);
    const numbers = new CalledNumbersService(
      client as never,
      realtime as never,
      audit,
      performance as never,
      {} as never,
    );
    return { claims, evaluation, audit, timing, numbers };
  }

  function postClaim(
    s: ReturnType<typeof service>,
    sessionId: string,
    userId: string,
    dto: CreateBingoClaimDto,
  ): Promise<ClaimResponse> {
    return s.claims.claimBingo(
      sessionId,
      userId,
      dto,
    ) as Promise<ClaimResponse>;
  }

  async function fixture(
    category: GameCategory = GameCategory.NORMAL,
    valid = true,
    players = 1,
  ) {
    const id = randomUUID();
    const rule = await db.gameRule.findUniqueOrThrow({
      where: { key: 'ONE_LINE' },
    });
    const slot = await db.gameSlot.create({
      data: {
        staticCode: `FENCE-${id}`,
        name: 'Fencing test',
        category,
        gameType: 'ONE_LINE',
        gameRuleId: rule.id,
        status: GameStatus.PLAYING,
        roundCount:
          category === GameCategory.CHAIN_GAME ||
          category === GameCategory.BIG_GAME
            ? 3
            : 1,
      },
    });
    createdSlotIds.push(slot.id);
    const session = await db.gameSession.create({
      data: {
        gameSlotId: slot.id,
        gameRuleId: rule.id,
        playCode: `FENCE-${id}`,
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
        autoCallIntervalMs: 3000,
        nextAutoCallAt: new Date(Date.now() + 2500),
        prizeAmount: 100,
      },
    });
    const cards: Array<{
      userId: string;
      id: string;
      number: number;
      uuid: string;
    }> = [];
    for (let i = 0; i < players; i++) {
      const number = nextCardNumber++;
      const user = await db.user.create({
        data: {
          fullName: 'Fencing player',
          phoneNumber: `+251${number}${randomUUID().slice(0, 6)}`,
        },
      });
      createdUserIds.push(user.id);
      const cartela = await db.cartela.create({
        data: {
          number,
          b: [1, 2, 3, 4, 5],
          i: [16, 17, 18, 19, 20],
          n: [31, 32, 'FREE', 34, 35],
          g: [46, 47, 48, 49, 50],
          o: [61, 62, 63, 64, 65],
        },
      });
      createdCartelaIds.push(cartela.id);
      const card = await db.gameCartela.create({
        data: {
          gameSessionId: session.id,
          userId: user.id,
          cartelaId: cartela.id,
        },
      });
      cards.push({ userId: user.id, id: card.id, number, uuid: randomUUID() });
    }
    const called = valid ? [1, 16, 31, 46, 61] : [1, 16, 31, 46];
    await db.calledNumber.createMany({
      data: called.map((number, index) => ({
        id: randomUUID(),
        gameSessionId: session.id,
        number,
        letter: ['B', 'I', 'N', 'G', 'O'][index],
        order: index + 1,
      })),
    });
    return { session, slot, cards };
  }

  async function accept(
    s: ReturnType<typeof service>,
    f: Awaited<ReturnType<typeof fixture>>,
    index = 0,
  ) {
    const card = f.cards[index];
    return db.$transaction<any>(
      (tx) =>
        (s.claims as any).acceptClaimAttempt(tx, {
          sessionId: f.session.id,
          userId: card.userId,
          gameCartelaId: card.id,
          claimAttemptId: card.uuid,
          clientTapAt: null,
          requestId: 'stage2a-test',
        }),
      txnOptions,
    );
  }

  function validate(s: ReturnType<typeof service>, accepted: any, client = db) {
    return client.$transaction<any>(
      (tx) =>
        (s.claims as any).createAutoValidatedClaim(
          tx,
          accepted.gameCartela,
          accepted.gameCartela.userId,
          accepted.ruleKey,
          {
            existingClaimId: accepted.claimId,
            claimAttemptId: accepted.claimAttemptId,
            receivedAt: accepted.receivedAt,
            pausedRemainingMs: accepted.pausedRemainingMs,
            hadScheduledAutoCall: accepted.hadScheduledAutoCall,
            autoCallAlreadyPaused: true,
          },
        ),
      txnOptions,
    );
  }

  function fail(s: ReturnType<typeof service>, a: any) {
    const card = a.gameCartela;
    return (s.claims as any).finalizeFailedClaimAttempt({
      claimId: a.claimId,
      claimAttemptId: a.claimAttemptId,
      sessionId: card.gameSessionId,
      userId: card.userId,
      gameCartelaId: card.id,
      cartelaNumber: card.cartela.number,
      slotId: card.gameSession.gameSlot.id,
      gameStatus: card.gameSession.status,
      receivedAt: a.receivedAt,
      pausedRemainingMs: a.pausedRemainingMs,
      hadScheduledAutoCall: a.hadScheduledAutoCall,
      autoCallEnabled: card.gameSession.autoCallEnabled,
      autoCallIntervalMs: card.gameSession.autoCallIntervalMs,
      error: new Error('injected technical failure'),
    });
  }

  async function claimLocked(claimId: string) {
    const client = await observer.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(
          'SELECT id FROM "BingoClaim" WHERE id=$1 FOR UPDATE NOWAIT',
          [claimId],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function competitorBlocked() {
    for (let i = 0; i < 200; i++) {
      const rows =
        await observer.query(`SELECT pid, wait_event_type, pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='stage2a-competitor' AND wait_event_type='Lock'`);
      if (rows.rowCount && rows.rows.some((r) => r.blockers.length > 0)) {
        console.log('REAL_LOCK_WAIT', JSON.stringify(rows.rows));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected an observable PostgreSQL lock wait');
  }

  for (const category of Object.values(GameCategory)) {
    for (const outcome of ['VALID', 'INVALID', 'FAILED'] as const) {
      it(`${category}: public claim ${outcome}, authoritative row/event/cartela`, async () => {
        const s = service();
        const f = await fixture(category, outcome !== 'INVALID');
        const card = f.cards[0];
        if (outcome === 'FAILED')
          jest.spyOn(s.evaluation, 'evaluate').mockImplementation(() => {
            throw new Error('injected evaluator failure');
          });
        const result = await postClaim(s, f.session.id, card.userId, {
          gameCartelaId: card.id,
          claimAttemptId: card.uuid,
        });
        const row = await db.bingoClaim.findUniqueOrThrow({
          where: { claimAttemptId: card.uuid },
        });
        const persistedCard = await db.gameCartela.findUniqueOrThrow({
          where: { id: card.id },
        });
        expect(row.status).toBe(outcome);
        expect(result.claim.status).toBe(outcome);
        expect(result.retryAllowed ?? false).toBe(outcome === 'FAILED');
        expect(persistedCard.status).toBe(
          outcome === 'VALID'
            ? GameCartelaStatus.WINNER
            : outcome === 'INVALID'
              ? GameCartelaStatus.BLOCKED
              : GameCartelaStatus.REGISTERED,
        );
        expect(
          events.filter(
            (e) =>
              e.event ===
              (outcome === 'VALID'
                ? 'game:winner_window_started'
                : outcome === 'INVALID'
                  ? 'game:bingo_invalid'
                  : 'game:bingo_claim_failed'),
          ),
        ).toHaveLength(1);
        const session = await db.gameSession.findUniqueOrThrow({
          where: { id: f.session.id },
        });
        if (outcome === 'VALID') {
          expect(session.status).toBe(GameStatus.WINNER_WINDOW);
          expect(session.nextAutoCallAt).toBeNull();
          expect(result).toHaveProperty('completedPatterns');
        } else {
          expect(session.status).toBe(GameStatus.PLAYING);
          expect(result.nextAutoCallAt).toBe(
            session.nextAutoCallAt?.toISOString(),
          );
          expect(session.nextAutoCallAt).not.toBeNull();
        }
      });
    }
    it(`${category}: five simultaneous winners share one unchanged window`, async () => {
      const s = service();
      const f = await fixture(category, true, 5);
      const results = await Promise.all(
        f.cards.map((card) =>
          postClaim(s, f.session.id, card.userId, {
            gameCartelaId: card.id,
            claimAttemptId: card.uuid,
          }),
        ),
      );
      expect(
        results.every((r) => r.claim.status === BingoClaimStatus.VALID),
      ).toBe(true);
      expect(new Set(results.map((r) => r.winnerWindowEndsAt)).size).toBe(1);
      expect(
        events.filter((e) => e.event === 'game:winner_window_started'),
      ).toHaveLength(1);
      expect(
        events.filter((e) => e.event === 'game:winner_window_joined'),
      ).toHaveLength(4);
      expect(
        await db.auditLog.count({
          where: { entityId: { in: results.map((r) => r.claim.id) } },
        }),
      ).toBe(5);
    });
  }

  for (const valid of [true, false]) {
    it(`claim row fenced before evaluation; active ${valid ? 'VALID' : 'INVALID'} defeats failure finalizer`, async () => {
      const s = service();
      const competitor = service(otherDb);
      const a = await accept(s, await fixture(GameCategory.NORMAL, valid));
      const entered = barrier();
      const release = barrier();
      const evaluation = jest.spyOn(s.evaluation, 'evaluate');
      s.timing.getWinnerWindowDurationMs.mockImplementation(async () => {
        entered.release();
        await release.promise;
        return 25_000;
      });
      const validation = validate(s, a);
      await entered.promise;
      const failure = fail(competitor, a);
      try {
        await claimLocked(a.claimId);
        await competitorBlocked();
        expect(evaluation).not.toHaveBeenCalled();
        expect(
          (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
            .status,
        ).toBe(BingoClaimStatus.CHECKING);
      } finally {
        release.release();
      }
      const [winner, loser] = await Promise.all([validation, failure]);
      expect(winner.claim.status).toBe(
        valid ? BingoClaimStatus.VALID : BingoClaimStatus.INVALID,
      );
      expect(loser.kind).toBe('already_resolved');
      expect(loser.claim.status).toBe(winner.claim.status);
      expect(loser.response.retryAllowed).toBe(false);
      expect(loser.response.isWinner).toBe(valid);
      expect(loser.response.gameCartelaStatus).toBe(
        valid ? GameCartelaStatus.WINNER : GameCartelaStatus.BLOCKED,
      );
    });
  }

  it('fence survives all side effects through commit; second validator rereads VALID', async () => {
    const s = service();
    const competitor = service(otherDb);
    const a = await accept(s, await fixture());
    const entered = barrier();
    const release = barrier();
    const original = s.audit.create.bind(s.audit);
    jest.spyOn(s.audit, 'create').mockImplementation(async (tx, input) => {
      await original(tx, input);
      entered.release();
      await release.promise;
    });
    const evaluation = jest.spyOn(competitor.evaluation, 'evaluate');
    const first = validate(s, a);
    await entered.promise;
    const second = validate(competitor, a, otherDb);
    try {
      await claimLocked(a.claimId);
      await competitorBlocked();
      const visible = await db.gameCartela.findUniqueOrThrow({
        where: { id: a.gameCartela.id },
      });
      expect(visible.status).toBe(GameCartelaStatus.REGISTERED);
    } finally {
      release.release();
    }
    const [one, two] = await Promise.all([first, second]);
    expect(one.claim.status).toBe(BingoClaimStatus.VALID);
    expect(two.kind).toBe('already_resolved');
    expect(two.claim.status).toBe(BingoClaimStatus.VALID);
    expect(evaluation).not.toHaveBeenCalled();
    expect(await db.auditLog.count({ where: { entityId: a.claimId } })).toBe(1);
  });

  it('failure winning first fences a delayed validator without any side effects', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    const evaluation = jest.spyOn(s.evaluation, 'evaluate');
    const failed = await fail(service(otherDb), a);
    const delayed = await validate(s, a);
    expect(failed.kind).toBe('auto_failed');
    expect(delayed.kind).toBe('already_resolved');
    expect(delayed.claim.status).toBe(BingoClaimStatus.FAILED);
    expect(delayed.response.retryAllowed).toBe(true);
    expect(evaluation).not.toHaveBeenCalled();
    expect(await db.auditLog.count({ where: { entityId: a.claimId } })).toBe(0);
    expect(
      (
        await db.gameCartela.findUniqueOrThrow({
          where: { id: a.gameCartela.id },
        })
      ).status,
    ).toBe(GameCartelaStatus.REGISTERED);
  });

  it('competing failure finalizers persist exactly one transition and one schedule', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    const results = await Promise.all([fail(s, a), fail(service(otherDb), a)]);
    expect(results.map((r) => r.kind).sort()).toEqual([
      'already_resolved',
      'auto_failed',
    ]);
    expect(
      results.every((r) => r.claim.status === BingoClaimStatus.FAILED),
    ).toBe(true);
    expect(results[0].response.nextAutoCallAt).toBe(
      results[1].response.nextAutoCallAt,
    );
    expect(results[0].claim.completedAt).toEqual(results[1].claim.completedAt);
  });

  it('validation rollback undoes cartela/session/audit before committed FAILED is emitted', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    const original = s.audit.create.bind(s.audit);
    jest.spyOn(s.audit, 'create').mockImplementation(async (tx, input) => {
      await original(tx, input);
      throw new Error('failure after all transactional side effects');
    });
    const result = await postClaim(s, f.session.id, card.userId, {
      gameCartelaId: card.id,
      claimAttemptId: card.uuid,
    });
    expect(result.claim.status).toBe(BingoClaimStatus.FAILED);
    expect(
      (await db.gameCartela.findUniqueOrThrow({ where: { id: card.id } }))
        .status,
    ).toBe(GameCartelaStatus.REGISTERED);
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .status,
    ).toBe(GameStatus.PLAYING);
    expect(
      await db.auditLog.count({ where: { entityId: result.claim.id } }),
    ).toBe(0);
    expect(
      events.filter((e) => e.event.startsWith('game:winner_window')),
    ).toHaveLength(0);
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
  });

  it('failed finalization rollback leaves CHECKING/pause and emits no terminal event', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    const rollbackClient = new Proxy(otherDb, {
      get(target, property) {
        if (property === '$transaction')
          return (fn: any, options: any) =>
            target.$transaction(async (tx) => {
              await fn(tx);
              throw new Error('injected finalization rollback');
            }, options);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(fail(service(rollbackClient), a)).rejects.toThrow(
      'injected finalization rollback',
    );
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .status,
    ).toBe(BingoClaimStatus.CHECKING);
    expect(
      (
        await db.gameSession.findUniqueOrThrow({
          where: { id: a.gameCartela.gameSessionId },
        })
      ).nextAutoCallAt,
    ).toBeNull();
    expect(events).toHaveLength(0);
    expect((await fail(s, a)).claim.status).toBe(BingoClaimStatus.FAILED);
  });

  for (const finalizer of ['FAILED', 'INVALID'] as const) {
    it(`${finalizer} cannot resume auto-call while another accepted CHECKING remains`, async () => {
      const s = service();
      const f = await fixture(GameCategory.NORMAL, false, 2);
      await db.gameSession.update({
        where: { id: f.session.id },
        data: { nextAutoCallAt: new Date(Date.now() - 500) },
      });
      const a = await accept(s, f);
      const b = await accept(s, f, 1);
      const result =
        finalizer === 'FAILED' ? await fail(s, b) : await validate(s, b);
      expect(result.response.nextAutoCallAt).toBeNull();
      await expect(
        s.numbers.callRandomNumberForAutoCall(f.session.id, {
          intervalMs: 3000,
          scheduledDueAt: f.session.nextAutoCallAt!,
          nextAutoCallAt: new Date(Date.now() + 3000),
        }),
      ).rejects.toBeInstanceOf(AutoCallClaimLostError);
      expect(
        await db.calledNumber.count({ where: { gameSessionId: f.session.id } }),
      ).toBe(4);
      await fail(s, a);
      const drawn = await s.numbers.callRandomNumberForAutoCall(f.session.id, {
        intervalMs: 3000,
        scheduledDueAt: f.session.nextAutoCallAt!,
        nextAutoCallAt: new Date(Date.now() + 3000),
      });
      expect(drawn.payload.order).toBe(5);
    });
  }

  it('stale auto-call tick loses after the receipt/pause transaction commits', async () => {
    const s = service();
    const f = await fixture();
    await accept(s, f);
    await expect(
      s.numbers.callRandomNumberForAutoCall(f.session.id, {
        intervalMs: 3000,
        scheduledDueAt: f.session.nextAutoCallAt!,
        nextAutoCallAt: new Date(Date.now() + 3000),
      }),
    ).rejects.toBeInstanceOf(AutoCallClaimLostError);
    expect(
      await db.calledNumber.count({ where: { gameSessionId: f.session.id } }),
    ).toBe(5);
  });

  for (const status of [GameStatus.WINNER_WINDOW, GameStatus.FINISHED]) {
    it(`FAILED rereads ${status}; cannot restore a stale PLAYING schedule`, async () => {
      const s = service();
      const f = await fixture();
      const a = await accept(s, f);
      await db.gameSession.update({
        where: { id: f.session.id },
        data: {
          status,
          autoCallEnabled: false,
          winnerWindowEndsAt: new Date(Date.now() + 25_000),
        },
      });
      const result = await fail(s, a);
      expect(result.response.gameStatus).toBe(status);
      expect(result.response.nextAutoCallAt).toBeNull();
      expect(result.leanAutoCall.autoCallEnabled).toBe(false);
    });
  }

  it('FAILED preserves an existing live schedule instead of overwriting it', async () => {
    const s = service();
    const f = await fixture();
    const a = await accept(s, f);
    const scheduledAt = new Date(Date.now() + 10_000);
    await db.gameSession.update({
      where: { id: f.session.id },
      data: { nextAutoCallAt: scheduledAt },
    });
    const result = await fail(s, a);
    expect(result.response.nextAutoCallAt).toBe(scheduledAt.toISOString());
  });

  it('duplicate UUID is idempotent under real concurrent POSTs', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    const results = await Promise.all(
      [0, 1].map(() =>
        postClaim(s, f.session.id, card.userId, {
          gameCartelaId: card.id,
          claimAttemptId: card.uuid,
        }),
      ),
    );
    expect(new Set(results.map((r) => r.claim.id)).size).toBe(1);
    expect(
      await db.bingoClaim.count({ where: { claimAttemptId: card.uuid } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: results[0].claim.id } }),
    ).toBe(1);
  });

  it('manual PENDING stays authoritative and is never finalized as technical FAILED', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    const manual = await db.gameRule.findUniqueOrThrow({
      where: { key: 'MANUAL' },
    });
    await db.gameSession.update({
      where: { id: f.session.id },
      data: { gameRuleId: manual.id },
    });
    const pending = await postClaim(s, f.session.id, card.userId, {
      gameCartelaId: card.id,
      claimAttemptId: card.uuid,
    });
    expect(pending.claim.status).toBe(BingoClaimStatus.PENDING);
    const loaded = await (s.claims as any).loadClaimCartela(
      db,
      f.session.id,
      card.userId,
      card.id,
    );
    const result = await fail(s, {
      claimId: pending.claim.id,
      claimAttemptId: card.uuid,
      receivedAt: new Date(),
      gameCartela: loaded,
      pausedRemainingMs: 0,
      hadScheduledAutoCall: false,
    });
    expect(result.kind).toBe('already_resolved');
    expect(result.claim.status).toBe(BingoClaimStatus.PENDING);
    expect(result.response.retryAllowed).toBe(false);
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(0);
  });

  it('Chain advancement fences an accepted old-round validator', async () => {
    const s = service();
    const f = await fixture(GameCategory.CHAIN_GAME);
    const a = await accept(s, f);
    await db.gameSession.update({
      where: { id: f.session.id },
      data: {
        roundIndex: 2,
        autoCallEnabled: false,
        roundPausedUntil: new Date(Date.now() + 20_000),
      },
    });
    await expect(validate(s, a)).rejects.toThrow(
      'Claim round has already advanced',
    );
    const result = await fail(s, a);
    expect(result.claim.status).toBe(BingoClaimStatus.FAILED);
    expect(result.response.nextAutoCallAt).toBeNull();
    expect(
      (await db.gameCartela.findUniqueOrThrow({ where: { id: f.cards[0].id } }))
        .status,
    ).toBe(GameCartelaStatus.REGISTERED);
  });

  it('wrong attempt ownership cannot finalize another claim row', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await expect(
      fail(s, { ...a, claimAttemptId: randomUUID() }),
    ).rejects.toThrow('Bingo claim attempt not found');
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .status,
    ).toBe(BingoClaimStatus.CHECKING);
  });

  it('acceptance rollback persists neither receipt nor automatic-call pause', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    await expect(
      db.$transaction(async (tx) => {
        await (s.claims as any).acceptClaimAttempt(tx, {
          sessionId: f.session.id,
          userId: card.userId,
          gameCartelaId: card.id,
          claimAttemptId: card.uuid,
          clientTapAt: null,
          requestId: 'rollback-test',
        });
        throw new Error('acceptance rollback');
      }, txnOptions),
    ).rejects.toThrow('acceptance rollback');
    expect(
      await db.bingoClaim.findUnique({ where: { claimAttemptId: card.uuid } }),
    ).toBeNull();
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).toEqual(f.session.nextAutoCallAt);
    expect(events).toHaveLength(0);
  });

  it('public terminal event waits for the side-effect transaction commit', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    const entered = barrier();
    const release = barrier();
    const original = s.audit.create.bind(s.audit);
    jest.spyOn(s.audit, 'create').mockImplementation(async (tx, input) => {
      await original(tx, input);
      entered.release();
      await release.promise;
    });
    const posted = postClaim(s, f.session.id, card.userId, {
      gameCartelaId: card.id,
      claimAttemptId: card.uuid,
    });
    await entered.promise;
    try {
      expect(
        events.filter((e) => e.event === 'game:bingo_checking'),
      ).toHaveLength(1);
      expect(
        events.filter((e) => e.event.startsWith('game:winner_window')),
      ).toHaveLength(0);
      const receipt = await otherDb.bingoClaim.findUniqueOrThrow({
        where: { claimAttemptId: card.uuid },
      });
      expect(receipt.status).toBe(BingoClaimStatus.CHECKING);
      await claimLocked(receipt.id);
    } finally {
      release.release();
    }
    const result = await posted;
    expect(result.claim.status).toBe(BingoClaimStatus.VALID);
    expect(
      events.filter((e) => e.event === 'game:winner_window_started'),
    ).toHaveLength(1);
  });

  it('session-first transition cannot deadlock a validator that also needs the claim row', async () => {
    const s = service();
    const f = await fixture();
    const a = await accept(s, f);
    const transition = await observer.connect();
    await transition.query('BEGIN');
    await transition.query(
      'SELECT id FROM "GameSession" WHERE id=$1 FOR UPDATE',
      [f.session.id],
    );
    const competing = validate(service(otherDb), a, otherDb);
    try {
      await competitorBlocked();
      // Validator waits on the session before owning a claim row, so a session
      // transition can still acquire the child row without a lock-order cycle.
      await transition.query(
        'SELECT id FROM "BingoClaim" WHERE id=$1 FOR UPDATE NOWAIT',
        [a.claimId],
      );
    } finally {
      await transition.query('COMMIT');
      transition.release();
    }
    expect((await competing).claim.status).toBe(BingoClaimStatus.VALID);
  });

  it('auto-call already reading a due schedule loses after the acceptance pause commits', async () => {
    const s = service();
    const f = await fixture();
    const card = f.cards[0];
    await db.gameSession.update({
      where: { id: f.session.id },
      data: { nextAutoCallAt: new Date(Date.now() - 500) },
    });
    const entered = barrier();
    const release = barrier();
    const acceptance = db.$transaction(async (tx) => {
      const receipt = await (s.claims as any).acceptClaimAttempt(tx, {
        sessionId: f.session.id,
        userId: card.userId,
        gameCartelaId: card.id,
        claimAttemptId: card.uuid,
        clientTapAt: null,
        requestId: 'pause-race-test',
      });
      entered.release();
      await release.promise;
      return receipt;
    }, txnOptions);
    await entered.promise;
    const lost = expect(
      service(otherDb).numbers.callRandomNumberForAutoCall(f.session.id, {
        intervalMs: 3000,
        scheduledDueAt: f.session.nextAutoCallAt!,
        nextAutoCallAt: new Date(Date.now() + 3000),
      }),
    ).rejects.toBeInstanceOf(AutoCallClaimLostError);
    try {
      // Its plain read sees the previously committed due schedule, then the
      // conditional draw UPDATE waits behind the acceptance's session lock.
      await competitorBlocked();
    } finally {
      release.release();
    }
    await acceptance;
    await lost;
    expect(
      await db.calledNumber.count({ where: { gameSessionId: f.session.id } }),
    ).toBe(5);
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).toBeNull();
  });
  async function age(claimId: string, milliseconds = 90_000) {
    await db.bingoClaim.update({
      where: { id: claimId },
      data: { receivedAt: new Date(Date.now() - milliseconds) },
    });
  }

  it('recovery emits only after COMMIT, not while ownership or writes are uncommitted', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    const wrote = barrier();
    const release = barrier();
    const client = new Proxy(otherDb, {
      get(target, property) {
        if (property === '$transaction')
          return (fn: any, options: any) =>
            target.$transaction(async (tx) => {
              const result = await fn(tx);
              wrote.release();
              await release.promise;
              return result;
            }, options);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const recovering = recover(service(client));
    await wrote.promise;
    try {
      await claimLocked(a.claimId);
      expect(
        (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
          .status,
      ).toBe('CHECKING');
      expect(events).toHaveLength(0);
    } finally {
      release.release();
    }
    expect((await recovering).recovered).toBe(1);
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
  });

  it('shutdown finishes the owned transaction, stops remaining candidates and permits restart', async () => {
    const s = service();
    const f = await fixture(GameCategory.NORMAL, true, 2);
    const attempts = await Promise.all(
      f.cards.map((_, index) => accept(s, f, index)),
    );
    await Promise.all(attempts.map((a) => age(a.claimId)));
    const owned = barrier();
    const release = barrier();
    const persist = (s.claims as any).persistOwnedFailedClaim.bind(s.claims);
    jest
      .spyOn(s.claims as any, 'persistOwnedFailedClaim')
      .mockImplementationOnce(async (...args) => {
        owned.release();
        await release.promise;
        return persist(...args);
      });
    const worker = new BingoClaimRecoveryService(
      new ConfigService({ BINGO_CLAIM_RECOVERY_ENABLED: true }),
      s.claims,
    );
    worker.onApplicationBootstrap();
    await owned.promise;
    const shutdown = worker.onModuleDestroy();
    release.release();
    await shutdown;
    expect(
      await db.bingoClaim.count({
        where: {
          gameSessionId: f.session.id,
          status: BingoClaimStatus.CHECKING,
        },
      }),
    ).toBe(1);
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
    expect((await recover()).recovered).toBe(1);
  });

  it('Chain final round remains FINISHED; recovery never advances or restarts it', async () => {
    const s = service();
    const f = await fixture(GameCategory.CHAIN_GAME);
    const a = await accept(s, f);
    await age(a.claimId);
    await db.gameSession.update({
      where: { id: f.session.id },
      data: {
        roundIndex: 3,
        status: GameStatus.FINISHED,
        autoCallEnabled: false,
      },
    });
    const before = await db.gameSession.findUniqueOrThrow({
      where: { id: f.session.id },
    });
    const rounds = new ChainRoundService(db as never, {} as never);
    expect(
      rounds.shouldContinueAfterRound({ ...before, gameSlot: f.slot }),
    ).toBe(false);
    expect((await recover()).recovered).toBe(1);
    expect(
      await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }),
    ).toEqual(before);
  });

  async function recover(s = service(otherDb)) {
    return s.claims.recoverOrphanedCheckingClaims();
  }

  it('terminated PostgreSQL finalizer connection rolls back and is recoverable', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    const failing = service(otherDb);
    const persist = (failing.claims as any).persistOwnedFailedClaim.bind(
      failing.claims,
    );
    jest
      .spyOn(failing.claims as any, 'persistOwnedFailedClaim')
      .mockImplementationOnce(async (...args) => {
        await persist(...args);
        const tx = args[0] as Prisma.TransactionClient;
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        expect(
          (
            await observer.query(
              'SELECT pg_terminate_backend($1) AS terminated',
              [pid],
            )
          ).rows[0].terminated,
        ).toBe(true);
        // Prove the connection has failed before the transaction can COMMIT.
        await tx.$queryRaw`SELECT 1`;
      });
    await expect(fail(failing, a)).rejects.toThrow();
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .status,
    ).toBe('CHECKING');
    expect(
      (
        await db.gameSession.findUniqueOrThrow({
          where: { id: a.gameCartela.gameSessionId },
        })
      ).nextAutoCallAt,
    ).toBeNull();
    expect(events).toHaveLength(0);
    await age(a.claimId);
    expect((await recover()).recovered).toBe(1);
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .failureCode,
    ).toBe('CLAIM_ORPHANED');
  });

  for (const valid of [true, false]) {
    it(`recovery skips a locked active ${valid ? 'VALID' : 'INVALID'} validator`, async () => {
      const s = service();
      const a = await accept(s, await fixture(GameCategory.NORMAL, valid));
      await age(a.claimId);
      const entered = barrier();
      const release = barrier();
      s.timing.getWinnerWindowDurationMs.mockImplementation(async () => {
        entered.release();
        await release.promise;
        return 25_000;
      });
      const validating = validate(s, a);
      await entered.promise;
      try {
        await claimLocked(a.claimId);
        const start = Date.now();
        expect(await recover()).toEqual({ candidates: 1, recovered: 0 });
        console.log('RECOVERY_SKIP_ACTIVE_LOCK_MS', Date.now() - start);
        expect(
          events.filter((e) => e.event === 'game:bingo_claim_failed'),
        ).toHaveLength(0);
      } finally {
        release.release();
      }
      expect((await validating).claim.status).toBe(valid ? 'VALID' : 'INVALID');
      expect((await recover()).recovered).toBe(0);
    });

    it(`recovery winning first fences delayed ${valid ? 'VALID' : 'INVALID'} validation`, async () => {
      const s = service();
      const f = await fixture(GameCategory.NORMAL, valid);
      const a = await accept(s, f);
      await age(a.claimId);
      expect((await recover()).recovered).toBe(1);
      const evaluate = jest.spyOn(s.evaluation, 'evaluate');
      const result = await validate(s, a);
      expect(result.kind).toBe('already_resolved');
      expect(result.claim.status).toBe('FAILED');
      expect(result.claim.failureCode).toBe('CLAIM_ORPHANED');
      expect(evaluate).not.toHaveBeenCalled();
      const card = await db.gameCartela.findUniqueOrThrow({
        where: { id: f.cards[0].id },
      });
      expect(card.status).toBe('REGISTERED');
      expect(card.isWinner).toBe(false);
      expect(
        events.filter((e) => e.event === 'game:bingo_claim_failed'),
      ).toHaveLength(1);
    });
  }

  it('claim-row SKIP LOCKED skips another transaction even when session is free', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    const client = await observer.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM "BingoClaim" WHERE id=$1 FOR UPDATE', [
        a.claimId,
      ]);
      expect(await recover()).toEqual({ candidates: 1, recovered: 0 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await recover()).recovered).toBe(1);
  });

  for (const status of ['VALID', 'INVALID', 'FAILED'] as const) {
    it(`recovery never overwrites committed ${status}`, async () => {
      const s = service();
      const a = await accept(
        s,
        await fixture(GameCategory.NORMAL, status !== 'INVALID'),
      );
      await age(a.claimId);
      if (status === 'FAILED') await fail(s, a);
      else await validate(s, a);
      const before = await db.bingoClaim.findUniqueOrThrow({
        where: { id: a.claimId },
      });
      expect((await recover()).recovered).toBe(0);
      expect(
        await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }),
      ).toEqual(before);
      expect(
        events.filter((e) => e.event === 'game:bingo_claim_failed'),
      ).toHaveLength(0);
    });
  }

  for (const valid of [true, false]) {
    it(`rechecks stale candidate after concurrent ${valid ? 'VALID' : 'INVALID'} commit`, async () => {
      const s = service();
      const competing = service(otherDb);
      const a = await accept(s, await fixture(GameCategory.NORMAL, valid));
      await age(a.claimId);
      const selected = barrier();
      const release = barrier();
      const findMany = otherDb.bingoClaim.findMany.bind(otherDb.bingoClaim);
      jest
        .spyOn(otherDb.bingoClaim as any, 'findMany')
        .mockImplementationOnce(async (args: any) => {
          const rows = await findMany(args);
          selected.release();
          await release.promise;
          return rows;
        });
      const recovering = recover(competing);
      await selected.promise;
      try {
        await validate(s, a);
      } finally {
        release.release();
      }
      expect(await recovering).toEqual({ candidates: 1, recovered: 0 });
      expect(events).toHaveLength(0);
    });
  }

  it('two recovery workers observing the same claim finalize once', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    const owned = barrier();
    const release = barrier();
    const persist = (s.claims as any).persistOwnedFailedClaim.bind(s.claims);
    jest
      .spyOn(s.claims as any, 'persistOwnedFailedClaim')
      .mockImplementation(async (...args) => {
        owned.release();
        await release.promise;
        return persist(...args);
      });
    const first = recover(s);
    await owned.promise;
    try {
      await claimLocked(a.claimId);
      expect(await recover(service(otherDb))).toEqual({
        candidates: 1,
        recovered: 0,
      });
      expect(events).toHaveLength(0);
    } finally {
      release.release();
    }
    expect((await first).recovered).toBe(1);
    expect((await recover()).recovered).toBe(0);
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
  });

  it('normal FAILED finalization and recovery have compatible ownership', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    const owned = barrier();
    const release = barrier();
    const persist = (s.claims as any).persistOwnedFailedClaim.bind(s.claims);
    jest
      .spyOn(s.claims as any, 'persistOwnedFailedClaim')
      .mockImplementation(async (...args) => {
        owned.release();
        await release.promise;
        return persist(...args);
      });
    const failing = fail(s, a);
    await owned.promise;
    try {
      expect((await recover()).recovered).toBe(0);
    } finally {
      release.release();
    }
    expect((await failing).claim.failureCode).toBe('VALIDATION_INTERNAL_ERROR');
    expect((await recover()).recovered).toBe(0);
  });

  it('normal finalizer rereads FAILED after recovery owns the transition', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    expect((await recover()).recovered).toBe(1);
    expect((await fail(s, a)).kind).toBe('already_resolved');
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
  });

  function rollbackClient() {
    return new Proxy(otherDb, {
      get(target, property) {
        if (property === '$transaction')
          return (fn: any, options: any) =>
            target.$transaction(async (tx) => {
              await fn(tx);
              throw new Error('injected persistence rollback');
            }, options);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  it('recovery rollback emits no FAILED event and leaves durable CHECKING/pause', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId);
    const rollback = service(rollbackClient());
    jest
      .spyOn((rollback.claims as any).logger, 'error')
      .mockImplementation(() => {});
    expect((await recover(rollback)).recovered).toBe(0);
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .status,
    ).toBe('CHECKING');
    expect(
      (
        await db.gameSession.findUniqueOrThrow({
          where: { id: a.gameCartela.gameSessionId },
        })
      ).nextAutoCallAt,
    ).toBeNull();
    expect(events).toHaveLength(0);
    expect((await recover()).recovered).toBe(1);
  });

  it('failed normal terminal persistence is recoverable later', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await expect(fail(service(rollbackClient()), a)).rejects.toThrow(
      'injected persistence rollback',
    );
    await age(a.claimId);
    expect((await recover()).recovered).toBe(1);
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .failureCode,
    ).toBe('CLAIM_ORPHANED');
  });

  it('killed validator process releases ownership; startup recovers durable receipt', async () => {
    const s = service();
    const f = await fixture();
    const a = await accept(s, f);
    await age(a.claimId);
    // Separate OS process and PostgreSQL connection; kill before COMMIT.
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const { Client } = require('pg');
      (async () => {
        const client = new Client({connectionString: process.env.BINGO_FENCING_TEST_DATABASE_URL});
        await client.connect();
        await client.query('BEGIN');
        await client.query('SELECT id FROM "GameSession" WHERE id=$1 FOR UPDATE', [process.env.TEST_SESSION_ID]);
        await client.query('SELECT id FROM "BingoClaim" WHERE id=$1 FOR UPDATE', [process.env.TEST_CLAIM_ID]);
        await client.query('UPDATE "GameCartela" SET status=$2, "isWinner"=true WHERE id=$1', [process.env.TEST_CARTELA_ID, 'WINNER']);
        await client.query('UPDATE "BingoClaim" SET status=$2 WHERE id=$1', [process.env.TEST_CLAIM_ID, 'VALID']);
        process.stdout.write('OWNED_UNCOMMITTED\\n');
        setInterval(() => {}, 1000);
      })().catch(error => { console.error(error); process.exit(1); });
    `,
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        env: {
          ...process.env,
          TEST_SESSION_ID: f.session.id,
          TEST_CLAIM_ID: a.claimId,
          TEST_CARTELA_ID: f.cards[0].id,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    let output = '';
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (data) => {
        output += data;
        if (output.includes('OWNED_UNCOMMITTED')) resolve();
      });
      child.stderr!.on('data', (data) => {
        output += data;
      });
      child.once('error', reject);
      child.once('exit', () => {
        if (!output.includes('OWNED_UNCOMMITTED')) reject(new Error(output));
      });
    });
    try {
      await ready;
      expect((await recover()).recovered).toBe(0);
      await claimLocked(a.claimId);
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    const restarted = new BingoClaimRecoveryService(
      new ConfigService({ BINGO_CLAIM_RECOVERY_ENABLED: true }),
      service(otherDb).claims,
    );
    restarted.onApplicationBootstrap();
    await (restarted as any).inFlight;
    await restarted.onModuleDestroy();
    const persisted = await db.bingoClaim.findUniqueOrThrow({
      where: { id: a.claimId },
    });
    expect(persisted.status).toBe('FAILED');
    expect(persisted.claimAttemptId).toBe(a.claimAttemptId);
    expect(
      (await db.gameCartela.findUniqueOrThrow({ where: { id: f.cards[0].id } }))
        .status,
    ).toBe('REGISTERED');
    expect(
      events.filter((e) => e.event === 'game:bingo_claim_failed'),
    ).toHaveLength(1);
    console.log(
      'REAL_PROCESS_CRASH_RECOVERY',
      a.claimId,
      persisted.status,
      persisted.failureCode,
    );
  }, 20_000);

  it('fresh CHECKING and manual PENDING remain untouched', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    const manual = await fixture();
    const rule = await db.gameRule.findUniqueOrThrow({
      where: { key: 'MANUAL' },
    });
    await db.gameSession.update({
      where: { id: manual.session.id },
      data: { gameRuleId: rule.id },
    });
    const pending = await postClaim(
      s,
      manual.session.id,
      manual.cards[0].userId,
      {
        gameCartelaId: manual.cards[0].id,
        claimAttemptId: manual.cards[0].uuid,
      },
    );
    await age(pending.claim.id);
    expect(await recover()).toEqual({ candidates: 0, recovered: 0 });
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .status,
    ).toBe('CHECKING');
    expect(
      (
        await db.bingoClaim.findUniqueOrThrow({
          where: { id: pending.claim.id },
        })
      ).status,
    ).toBe('PENDING');
    await fail(s, a);
  });

  for (const category of Object.values(GameCategory)) {
    it(`${category}: orphan recovery preserves cartela and safe full-interval schedule`, async () => {
      const s = service();
      const f = await fixture(category);
      const a = await accept(s, f);
      await age(a.claimId);
      const before = Date.now();
      expect((await recover()).recovered).toBe(1);
      const session = await db.gameSession.findUniqueOrThrow({
        where: { id: f.session.id },
      });
      expect(session.nextAutoCallAt!.getTime()).toBeGreaterThanOrEqual(
        before + 3000,
      );
      expect(session.status).toBe('PLAYING');
      expect(session.roundIndex).toBe(f.session.roundIndex);
      const card = await db.gameCartela.findUniqueOrThrow({
        where: { id: f.cards[0].id },
      });
      expect(card.status).toBe('REGISTERED');
      expect(card.isWinner).toBe(false);
      await expect(
        s.numbers.callRandomNumberForAutoCall(f.session.id, {
          intervalMs: 3000,
          scheduledDueAt: f.session.nextAutoCallAt!,
          nextAutoCallAt: new Date(Date.now() + 3000),
        }),
      ).rejects.toBeInstanceOf(AutoCallClaimLostError);
      const response = await s.claims.getPlayerBingoClaimAttempt(
        f.session.id,
        f.cards[0].userId,
        f.cards[0].uuid,
      );
      expect(response.status).toBe('FAILED');
      expect(response.retryAllowed).toBe(true);
      expect(response.claimAttemptId).toBe(f.cards[0].uuid);
    });
  }

  it('recovery preserves a live automatic-call schedule', async () => {
    const s = service();
    const f = await fixture();
    const a = await accept(s, f);
    await age(a.claimId);
    const live = new Date(Date.now() + 8000);
    await db.gameSession.update({
      where: { id: f.session.id },
      data: { nextAutoCallAt: live },
    });
    await recover();
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).toEqual(live);
  });

  for (const status of [
    GameStatus.WINNER_WINDOW,
    GameStatus.FINISHED,
    GameStatus.NO_WINNER,
  ]) {
    it(`recovery cannot reopen or schedule ${status}`, async () => {
      const s = service();
      const f = await fixture();
      const a = await accept(s, f);
      await age(a.claimId);
      const deadline = new Date(Date.now() - 1000);
      await db.gameSession.update({
        where: { id: f.session.id },
        data: { status, winnerWindowEndsAt: deadline },
      });
      await recover();
      const session = await db.gameSession.findUniqueOrThrow({
        where: { id: f.session.id },
      });
      expect(session.status).toBe(status);
      expect(session.nextAutoCallAt).toBeNull();
      expect(session.winnerWindowEndsAt).toEqual(deadline);
    });
  }

  it('simultaneous players: recovery retains pause until last CHECKING, UUIDs remain independent', async () => {
    const s = service();
    const f = await fixture(GameCategory.NORMAL, true, 5);
    const accepted = await Promise.all(
      f.cards.map((_, index) => accept(s, f, index)),
    );
    await Promise.all(accepted.slice(0, 4).map((a) => age(a.claimId)));
    expect((await recover()).recovered).toBe(4);
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).toBeNull();
    await age(accepted[4].claimId);
    expect((await recover()).recovered).toBe(1);
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).not.toBeNull();
    expect(
      new Set(
        events
          .filter((e) => e.event === 'game:bingo_claim_failed')
          .map((e) => e.payload.claimAttemptId),
      ),
    ).toEqual(new Set(f.cards.map((c) => c.uuid)));
  });

  it('scan processes at most 25 candidates and resumes after the remainder is resolved', async () => {
    const s = service();
    const f = await fixture(GameCategory.NORMAL, true, 26);
    const accepted = await Promise.all(
      f.cards.map((_, index) => accept(s, f, index)),
    );
    await Promise.all(accepted.map((a) => age(a.claimId)));
    const start = Date.now();
    expect(await recover()).toEqual({ candidates: 25, recovered: 25 });
    console.log('RECOVERY_25_CLAIMS_MS', Date.now() - start);
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).toBeNull();
    expect(await recover()).toEqual({ candidates: 1, recovered: 1 });
    expect(
      (await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .nextAutoCallAt,
    ).not.toBeNull();
  }, 20_000);

  it('Chain intermediate advance retains its pause, rule, prize and new round', async () => {
    const s = service();
    const f = await fixture(GameCategory.CHAIN_GAME);
    const a = await accept(s, f);
    await age(a.claimId);
    const rounds = new ChainRoundService(db as never, {} as never);
    jest.spyOn((rounds as any).logger, 'log').mockImplementation(() => {});
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "GameSession" WHERE id=${f.session.id} FOR UPDATE`;
      await rounds.advanceToNextRound(tx, {
        sessionId: f.session.id,
        finishedRoundIndex: 1,
        slot: f.slot,
        winnerCartelaIds: [],
      });
    }, txnOptions);
    const before = await db.gameSession.findUniqueOrThrow({
      where: { id: f.session.id },
    });
    expect(before.roundIndex).toBe(2);
    await recover();
    expect(
      await db.gameSession.findUniqueOrThrow({ where: { id: f.session.id } }),
    ).toEqual(before);
    expect((await validate(s, a)).claim.status).toBe('FAILED');
  });

  for (const final of [false, true]) {
    it(`Big Game ${final ? 'final' : 'intermediate'} real handoff remains intact after recovery`, async () => {
      const s = service();
      const f = await fixture(GameCategory.BIG_GAME);
      const a = await accept(s, f);
      await age(a.claimId);
      const rounds = new BigGameRoundService(
        db as never,
        { expireAllForSlot: jest.fn(async () => {}) } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      jest.spyOn((rounds as any).logger, 'log').mockImplementation(() => {});
      const handoff = await db.$transaction(async (tx) => {
        await tx.gameSession.update({
          where: { id: f.session.id },
          data: {
            status: GameStatus.FINISHED,
            autoCallEnabled: false,
            roundIndex: final ? 3 : 1,
          },
        });
        return rounds.afterBigGameRoundFinalized(tx, {
          sessionId: f.session.id,
          gameSlotId: f.slot.id,
          registrationDurationSeconds: 20,
        });
      }, txnOptions);
      const before = await db.gameSession.findMany({
        where: { gameSlotId: f.slot.id },
        orderBy: { roundIndex: 'asc' },
      });
      await recover();
      expect(
        await db.gameSession.findMany({
          where: { gameSlotId: f.slot.id },
          orderBy: { roundIndex: 'asc' },
        }),
      ).toEqual(before);
      expect(handoff.shouldRemoveSlot).toBe(final);
      expect(handoff.nextRoundIndex).toBe(final ? null : 2);
      if (!final) {
        expect(before[1].status).toBe('READY');
        expect(
          await db.gameCartela.count({
            where: { gameSessionId: handoff.nextSessionId! },
          }),
        ).toBe(1);
      }
    });
  }

  it('very old receipt can recover without overflowing the existing duration integer', async () => {
    const s = service();
    const a = await accept(s, await fixture());
    await age(a.claimId, 40 * 24 * 60 * 60 * 1000);
    expect((await recover()).recovered).toBe(1);
    expect(
      (await db.bingoClaim.findUniqueOrThrow({ where: { id: a.claimId } }))
        .durationMs,
    ).toBe(2_147_483_647);
  });
});
