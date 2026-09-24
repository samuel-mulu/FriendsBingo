import { GameCartelaStatus, GameStatus } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

describe('BingoClaimsService claimBingo post-commit latency', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const gameCartelaId = '33333333-3333-3333-3333-333333333333';
  const claimId = '44444444-4444-4444-4444-444444444444';

  function buildValidOpenResult() {
    const winnerWindowEndsAt = new Date('2026-09-24T12:00:00.000Z');
    const claim = {
      id: claimId,
      gameSessionId: sessionId,
      userId,
      gameCartelaId,
      status: 'VALID',
      checkedPattern: 'ONE_LINE',
      reason: null,
      reasonCode: null,
      createdAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
    };
    return {
      kind: 'auto_valid_open' as const,
      sessionId,
      slotId: 'slot-1',
      gameStatus: GameStatus.WINNER_WINDOW,
      userId,
      gameCartelaId,
      cartelaNumber: 12,
      claim,
      winnerWindowEndsAt,
      completedPatterns: [],
      lastCalledNumber: null,
      sessionStatusBefore: GameStatus.PLAYING,
      cartelaStatusBefore: GameCartelaStatus.REGISTERED,
      leanAutoCall: {
        autoCallEnabled: false,
        autoCallIntervalMs: 3000,
        nextAutoCallAt: null,
      },
      response: {
        claim,
        progress: 1,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: winnerWindowEndsAt.toISOString(),
        reasonCode: null,
        completedPatterns: [],
        lastCalledNumber: null,
        nextAutoCallAt: null,
      },
    };
  }

  function buildInvalidResult() {
    const claim = {
      id: claimId,
      gameSessionId: sessionId,
      userId,
      gameCartelaId,
      status: 'INVALID',
      checkedPattern: 'ONE_LINE',
      reason: 'Claim did not match the active game rule pattern',
      reasonCode: 'INVALID_PATTERN',
      createdAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
    };
    return {
      kind: 'auto_invalid' as const,
      sessionId,
      slotId: 'slot-1',
      gameStatus: GameStatus.PLAYING,
      userId,
      gameCartelaId,
      cartelaNumber: 12,
      claim,
      sessionStatusBefore: GameStatus.PLAYING,
      cartelaStatusBefore: GameCartelaStatus.REGISTERED,
      leanAutoCall: {
        autoCallEnabled: true,
        autoCallIntervalMs: 3000,
        nextAutoCallAt: new Date('2026-09-24T12:00:02.000Z').toISOString(),
      },
      response: {
        claim,
        progress: null,
        isWinner: false,
        gameStatus: GameStatus.PLAYING,
        gameCartelaStatus: GameCartelaStatus.BLOCKED,
        reasonCode: 'INVALID_PATTERN',
        nextAutoCallAt: new Date('2026-09-24T12:00:02.000Z').toISOString(),
      },
    };
  }

  function createService(options: {
    txnResult: ReturnType<typeof buildValidOpenResult> | ReturnType<typeof buildInvalidResult>;
    structuralDelayMs?: number;
    structuralThrows?: boolean;
  }) {
    const emitToGame = jest.fn();
    const emitToAdmin = jest.fn();
    const emitToUser = jest.fn();
    const emitToPublicGames = jest.fn();
    const emitGameOperationUpdate = jest.fn();

    let structuralStarted = false;
    let structuralFinished = false;

    const findUnique = jest.fn(async () => {
      structuralStarted = true;
      if (options.structuralThrows) {
        throw new Error('structural snapshot failed');
      }
      if (options.structuralDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.structuralDelayMs),
        );
      }
      structuralFinished = true;
      return null;
    });

    const prisma = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      gameSession: {
        findUnique,
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async () => options.txnResult),
    };

    const realtimeService = {
      emitToGame,
      emitToAdmin,
      emitToUser,
      emitToPublicGames,
      emitGameOperationUpdate,
    };

    const requestPerformance = {
      run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
    };

    const requestContext = {
      getRequestIdForLog: jest.fn(() => 'req-test'),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      {} as never,
      realtimeService as never,
      {} as never,
      {} as never,
      {} as never,
      requestPerformance as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      {} as never,
      {
        notifyWinnerWindowStarted: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      requestContext as never,
    );

    return {
      service,
      emitToGame,
      emitToAdmin,
      emitToUser,
      get structuralStarted() {
        return structuralStarted;
      },
      get structuralFinished() {
        return structuralFinished;
      },
    };
  }

  it('returns VALID HTTP without waiting for deferred structural refresh', async () => {
    const harness = createService({
      txnResult: buildValidOpenResult(),
      structuralDelayMs: 2000,
    });

    const started = Date.now();
    const response = await harness.service.claimBingo(
      sessionId,
      userId,
      gameCartelaId,
    );
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(500);
    expect(response).toMatchObject({
      isWinner: true,
      gameStatus: GameStatus.WINNER_WINDOW,
      gameCartelaStatus: GameCartelaStatus.WINNER,
    });
    expect(harness.emitToGame).toHaveBeenCalledWith(
      sessionId,
      'game:winner_window_started',
      expect.objectContaining({ claimId, gameCartelaId }),
    );
    expect(harness.emitToUser).toHaveBeenCalledWith(
      userId,
      'game:winner_window_started',
      expect.objectContaining({ claimId }),
    );
    expect(harness.emitToAdmin).toHaveBeenCalledWith(
      'game:winner_window_started',
      expect.objectContaining({ claimId }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.structuralStarted).toBe(true);
    expect(harness.structuralFinished).toBe(false);
  });

  it('still returns committed INVALID when deferred structural refresh throws', async () => {
    const harness = createService({
      txnResult: buildInvalidResult(),
      structuralThrows: true,
    });

    const response = await harness.service.claimBingo(
      sessionId,
      userId,
      gameCartelaId,
    );

    expect(response).toMatchObject({
      isWinner: false,
      gameCartelaStatus: GameCartelaStatus.BLOCKED,
      reasonCode: 'INVALID_PATTERN',
    });
    expect(harness.emitToGame).toHaveBeenCalledWith(
      sessionId,
      'game:bingo_invalid',
      expect.objectContaining({ claimId, reasonCode: 'INVALID_PATTERN' }),
    );
    expect(harness.emitToUser).toHaveBeenCalledWith(
      userId,
      'game:bingo_invalid',
      expect.objectContaining({ claimId }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('emits bingo_invalid synchronously for INVALID claims', async () => {
    const harness = createService({
      txnResult: buildInvalidResult(),
    });

    await harness.service.claimBingo(sessionId, userId, gameCartelaId);

    const invalidCalls = harness.emitToGame.mock.calls.filter(
      (call) => call[1] === 'game:bingo_invalid',
    );
    expect(invalidCalls).toHaveLength(1);
  });
});
