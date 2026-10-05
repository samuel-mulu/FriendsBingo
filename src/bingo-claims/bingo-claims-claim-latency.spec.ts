import { BingoClaimStatus, GameCartelaStatus, GameStatus } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

/**
 * Latency tests adapted for two-phase claim flow:
 * accept CHECKING txn → bingo_checking → validation txn → terminal emit.
 */
describe('BingoClaimsService claimBingo post-commit latency', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const gameCartelaId = '33333333-3333-3333-3333-333333333333';
  const claimAttemptId = '55555555-5555-5555-5555-555555555555';
  const claimId = '44444444-4444-4444-4444-444444444444';

  function baseClaim(status: string, extra: Record<string, unknown> = {}) {
    return {
      id: claimId,
      claimAttemptId,
      gameSessionId: sessionId,
      userId,
      gameCartelaId,
      status,
      attemptNumber: 1,
      checkedPattern: 'ONE_LINE',
      reason: null,
      reasonCode: null,
      failureCode: null,
      failureMessage: null,
      winningBallLetter: null,
      winningBallNumber: null,
      receiptBallLetter: 'B',
      receiptBallNumber: 1,
      receiptCalledOrder: 1,
      calledNumbersCountAtReceipt: 1,
      receivedAt: new Date(),
      completedAt: new Date(),
      durationMs: 10,
      requestId: 'req-test',
      clientTapAt: null,
      createdAt: new Date(),
      checkedAt: new Date(),
      ...extra,
    };
  }

  function acceptChecking() {
    return {
      kind: 'auto_checking' as const,
      claimId,
      claimAttemptId,
      attemptNumber: 1,
      receivedAt: new Date(),
      gameCartela: {
        id: gameCartelaId,
        gameSessionId: sessionId,
        userId,
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 12, b: [], i: [], n: [], g: [], o: [] },
        gameSession: {
          id: sessionId,
          playCode: 'BINGO-1',
          status: GameStatus.PLAYING,
          prizeAmount: { toString: () => '100' },
          autoCallEnabled: true,
          autoCallIntervalMs: 3000,
          nextAutoCallAt: null,
          winnerWindowEndsAt: null,
          gameRule: { id: 'r1', key: 'ONE_LINE', name: 'One Line', patterns: null },
          gameSlot: {
            id: 'slot-1',
            gameType: 'ONE_LINE',
            gameRule: { id: 'r1', key: 'ONE_LINE', name: 'One Line', patterns: null },
          },
        },
      },
      ruleKey: 'ONE_LINE',
      pausedRemainingMs: 0,
      hadScheduledAutoCall: false,
      cartelaNumber: 12,
    };
  }

  function buildValidOpenResult() {
    const winnerWindowEndsAt = new Date('2026-09-24T12:00:00.000Z');
    const claim = baseClaim(BingoClaimStatus.VALID);
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
    const claim = baseClaim(BingoClaimStatus.INVALID, {
      reason: 'Claim did not match the active game rule pattern',
      reasonCode: 'INVALID_PATTERN',
    });
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
    txnResult:
      | ReturnType<typeof buildValidOpenResult>
      | ReturnType<typeof buildInvalidResult>;
    structuralDelayMs?: number;
    structuralThrows?: boolean;
  }) {
    const emitToGame = jest.fn();
    const emitToAdmin = jest.fn();
    const emitToUser = jest.fn();

    let structuralStarted = false;
    let structuralFinished = false;
    let txnCalls = 0;

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
      return {
        id: sessionId,
        status: GameStatus.PLAYING,
        gameSlot: { id: 'slot-1' },
      };
    });

    const prisma = {
      bingoClaim: {
        findUnique: jest.fn(async () => null),
      },
      gameSession: { findUnique: findUnique },
      gameCartela: { findUnique: jest.fn() },
      $transaction: jest.fn(async () => {
        txnCalls += 1;
        if (txnCalls === 1) {
          return acceptChecking();
        }
        return options.txnResult;
      }),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      {} as never,
      {
        emitToGame,
        emitToAdmin,
        emitToUser,
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()) } as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      {} as never,
      {
        notifyWinnerWindowStarted: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: jest.fn(() => 'req-test') } as never,
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

  const dto = { gameCartelaId, claimAttemptId };

  it('returns VALID HTTP without waiting for deferred structural refresh', async () => {
    const harness = createService({
      txnResult: buildValidOpenResult(),
      structuralDelayMs: 2000,
    });

    const started = Date.now();
    const response = await harness.service.claimBingo(sessionId, userId, dto);
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(500);
    expect(response).toMatchObject({
      isWinner: true,
      gameStatus: GameStatus.WINNER_WINDOW,
      gameCartelaStatus: GameCartelaStatus.WINNER,
    });
    expect(harness.emitToGame).toHaveBeenCalledWith(
      sessionId,
      'game:bingo_checking',
      expect.objectContaining({ claimAttemptId, gameCartelaId }),
    );
    expect(harness.emitToGame).toHaveBeenCalledWith(
      sessionId,
      'game:winner_window_started',
      expect.objectContaining({ claimId, gameCartelaId }),
    );
  });

  it('still returns committed INVALID when deferred structural refresh throws', async () => {
    const harness = createService({
      txnResult: buildInvalidResult(),
      structuralThrows: true,
    });

    const response = await harness.service.claimBingo(sessionId, userId, dto);

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
  });

  it('emits bingo_invalid synchronously for INVALID claims', async () => {
    const harness = createService({
      txnResult: buildInvalidResult(),
    });

    await harness.service.claimBingo(sessionId, userId, dto);

    const invalidCalls = harness.emitToGame.mock.calls.filter(
      (call) => call[1] === 'game:bingo_invalid',
    );
    expect(invalidCalls).toHaveLength(1);
  });
});
