import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
} from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';

/** Persistence is deterministic; evaluation, window transitions and finalizers are real. */
describe('automatic claim persisted receipt snapshot', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  beforeEach(() => jest.useFakeTimers({ now }));
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function fixture(
    receiptCalledOrder: number | null = 5,
    calledNumbersCountAtReceipt: number | null = receiptCalledOrder,
  ) {
    const rule = { id: 'rule', key: 'ONE_LINE', name: 'Line', patterns: null };
    const session = {
      id: 'session',
      playCode: 'RECEIPT',
      status: GameStatus.PLAYING as GameStatus,
      roundIndex: 1,
      autoCallEnabled: true,
      autoCallIntervalMs: 3000,
      nextAutoCallAt: null as Date | null,
      winnerWindowEndsAt: null as Date | null,
      gameRule: rule,
      gameSlot: { id: 'slot', gameType: 'ONE_LINE', gameRule: rule },
    };
    const cartela = {
      id: 'gc',
      gameSessionId: 'session',
      userId: 'user',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: {
        id: 'board',
        number: 1,
        b: [1, 2, 3, 4, 5],
        i: [16, 17, 18, 19, 20],
        n: [31, 32, 'FREE', 34, 35],
        g: [46, 47, 48, 49, 50],
        o: [61, 62, 63, 64, 65],
      },
      gameSession: session,
    };
    const claim = {
      id: 'claim',
      claimAttemptId: 'uuid',
      gameSessionId: 'session',
      userId: 'user',
      gameCartelaId: 'gc',
      status: BingoClaimStatus.CHECKING,
      attemptNumber: 1,
      checkedPattern: null,
      reason: null,
      reasonCode: null,
      failureCode: null,
      failureMessage: null,
      winningBallLetter: null,
      winningBallNumber: null,
      receiptBallLetter: 'O',
      receiptBallNumber: 61,
      receiptCalledOrder,
      calledNumbersCountAtReceipt,
      receivedAt: now,
      createdAt: now,
      checkedAt: null,
      completedAt: null,
      durationMs: null,
      requestId: 'test',
      clientTapAt: null,
    };
    const calls = [1, 16, 31, 46, 61, 2].map((number, index) => ({
      number,
      letter: ['B', 'I', 'N', 'G', 'O', 'B'][index],
      order: index + 1,
    }));
    const tx = {
      $queryRaw: jest.fn(async (sql: TemplateStringsArray) =>
        sql.join('').includes('"BingoClaim"')
          ? [{ ...claim }]
          : [{ id: 'session' }],
      ),
      calledNumber: {
        findMany: jest.fn(
          async (query: { where: { order?: { lte: number } } }) =>
            calls.filter(
              (call) =>
                !query.where.order || call.order <= query.where.order.lte,
            ),
        ),
      },
      gameCartela: {
        findUniqueOrThrow: jest.fn(async () => cartela),
        findUnique: jest.fn(async () => cartela),
        updateMany: jest.fn(async ({ data }: { data: object }) => {
          Object.assign(cartela, data);
          return { count: 1 };
        }),
      },
      gameSession: {
        findUniqueOrThrow: jest.fn(async () => ({ ...session })),
        updateMany: jest.fn(async ({ data }: { data: object }) => {
          Object.assign(session, data);
          return { count: 1 };
        }),
      },
      bingoClaim: {
        findUniqueOrThrow: jest.fn(async () => ({ ...claim })),
        updateMany: jest.fn(async ({ data }: { data: object }) => {
          Object.assign(claim, data);
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      ...tx,
      bingoClaim: {
        ...tx.bingoClaim,
        findUnique: jest.fn(async (): Promise<typeof claim | null> => null),
      },
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      ),
    };
    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      new GameRuleEvaluationService(),
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      } as never,
      { create: jest.fn() } as never,
      {} as never,
      {} as never,
      { run: (_context: unknown, fn: () => unknown) => fn() } as never,
      {
        getAutoCallIntervalMs: async () => 3000,
        getWinnerWindowDurationMs: async () => 25_000,
        getWinnerWindowClaimGraceMs: async () => 1000,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: () => 'receipt-test' } as never,
    );
    const internal = service as any;
    jest.spyOn(internal.logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn(internal, 'runDeferredClaimStructuralRefresh')
      .mockResolvedValue(undefined);
    const accepted = {
      kind: 'auto_checking',
      claimId: 'claim',
      claimAttemptId: 'uuid',
      attemptNumber: 1,
      receivedAt: now,
      gameCartela: cartela,
      ruleKey: 'ONE_LINE',
      pausedRemainingMs: 1000,
      hadScheduledAutoCall: true,
      cartelaNumber: 1,
    };
    const validate = () =>
      internal.createAutoValidatedClaim(tx, cartela, 'user', 'ONE_LINE', {
        existingClaimId: 'claim',
        claimAttemptId: 'uuid',
        receivedAt: now,
        pausedRemainingMs: 1000,
        hadScheduledAutoCall: true,
        autoCallAlreadyPaused: true,
      });
    return {
      service,
      internal,
      accepted,
      validate,
      tx,
      prisma,
      claim,
      cartela,
      session,
      calls,
    };
  }

  it('stays valid at receipt after an unrelated later draw; winning ball is bounded', async () => {
    const f = fixture();
    const result = await f.validate();
    expect(result.claim.status).toBe(BingoClaimStatus.VALID);
    expect(result.lastCalledNumber).toEqual({ letter: 'O', number: 61 });
    expect(f.claim.winningBallNumber).toBe(61);
    expect(f.tx.calledNumber.findMany.mock.calls[0][0].where.order).toEqual({
      lte: 5,
    });
  });

  it('cannot use a later draw to complete an incomplete receipt', async () => {
    const f = fixture(4);
    f.calls.splice(5); // Draw 5 completes the row, after receipt 4.
    const result = await f.validate();
    expect(result.claim.status).toBe(BingoClaimStatus.INVALID);
    expect(result.claim.reasonCode).toBe('INVALID_PATTERN');
    expect(f.claim.winningBallNumber).toBe(46);
  });

  it('preserves rejection of a claim already late at receipt', async () => {
    const f = fixture(6);
    const result = await f.validate();
    expect(result.claim.reasonCode).toBe('INVALID_LATE_CLAIM');
    expect(f.claim.winningBallNumber).toBe(2);
  });

  it.each([null, 0])(
    'recorded zero-call receipt (%s) evaluates an empty snapshot',
    async (order) => {
      const f = fixture(order, 0);
      const result = await f.validate();
      expect(result.claim.reasonCode).toBe('INVALID_PATTERN');
      expect(f.claim.winningBallNumber).toBeNull();
      expect(f.tx.calledNumber.findMany.mock.calls[0][0].where.order).toEqual({
        lte: 0,
      });
    },
  );

  it.each([
    [null, null],
    [null, 4],
    [-1, 4],
    [0, 4],
    [NaN, 4],
    [5, null],
  ])(
    'unusable receipt (%s/%s) follows public fenced FAILED handling, never INVALID',
    async (order, count) => {
      const f = fixture(order, count);
      jest
        .spyOn(f.internal, 'acceptClaimAttempt')
        .mockResolvedValue(f.accepted);
      const result = await f.service.claimBingo('session', 'user', {
        gameCartelaId: 'gc',
        claimAttemptId: 'uuid',
      });
      expect(result.claim).toMatchObject({ status: BingoClaimStatus.FAILED });
      expect(result.retryAllowed).toBe(true);
      expect(f.claim.failureCode).toBe('VALIDATION_INTERNAL_ERROR');
      expect(f.cartela.status).toBe(GameCartelaStatus.REGISTERED);
      expect(f.tx.calledNumber.findMany).not.toHaveBeenCalled();
      expect(f.session.nextAutoCallAt).not.toBeNull();
    },
  );

  it('duplicate UUID returns the stored winner without reevaluating later draws', async () => {
    const f = fixture();
    await f.validate();
    f.prisma.bingoClaim.findUnique.mockResolvedValue(f.claim);
    f.tx.calledNumber.findMany.mockClear();
    const result = await f.service.claimBingo('session', 'user', {
      gameCartelaId: 'gc',
      claimAttemptId: 'uuid',
    });
    expect(result.claim).toMatchObject({
      status: BingoClaimStatus.VALID,
      claimAttemptId: 'uuid',
    });
    expect(f.tx.calledNumber.findMany).not.toHaveBeenCalled();
  });

  it('joins an existing winner window with the same receipt snapshot', async () => {
    const f = fixture();
    f.session.status = GameStatus.WINNER_WINDOW;
    f.session.winnerWindowEndsAt = new Date(now.getTime() + 10_000);
    const result = await f.validate();
    expect(result.kind).toBe('auto_valid_join');
    expect(result.lastCalledNumber).toEqual({ letter: 'O', number: 61 });
    expect(f.tx.gameSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not extend an expired winner window', async () => {
    const f = fixture();
    f.calls.splice(5);
    f.session.status = GameStatus.WINNER_WINDOW;
    f.session.winnerWindowEndsAt = new Date(now.getTime() - 1001);
    await expect(f.validate()).rejects.toThrow(
      'Winner window has already closed',
    );
    expect(f.tx.bingoClaim.updateMany).not.toHaveBeenCalled();
  });
});
