import { BingoClaimStatus, GameCartelaStatus, GameStatus } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

describe('BingoClaimsService claim attempt integrity', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const gameCartelaId = '33333333-3333-3333-3333-333333333333';
  const claimAttemptId = '55555555-5555-5555-5555-555555555555';
  const claimId = '44444444-4444-4444-4444-444444444444';

  function playerClaim(status: string) {
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
      receiptBallLetter: 'N',
      receiptBallNumber: 38,
      receiptCalledOrder: 12,
      calledNumbersCountAtReceipt: 12,
      receivedAt: new Date('2026-10-05T12:00:00.000Z'),
      completedAt: null,
      durationMs: null,
      requestId: 'req-test',
      clientTapAt: null,
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
      checkedAt: null,
    };
  }

  it('emits bingo_checking only after durable CHECKING accept txn', async () => {
    const emitOrder: string[] = [];
    const emitToGame = jest.fn((...args: unknown[]) => {
      emitOrder.push(String(args[1]));
    });

    const acceptResult = {
      kind: 'auto_checking' as const,
      claimId,
      claimAttemptId,
      attemptNumber: 1,
      receivedAt: new Date('2026-10-05T12:00:00.000Z'),
      gameCartela: {
        id: gameCartelaId,
        gameSessionId: sessionId,
        userId,
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: {
          id: 'c1',
          number: 12,
          b: [],
          i: [],
          n: [],
          g: [],
          o: [],
        },
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
      pausedRemainingMs: 1000,
      hadScheduledAutoCall: true,
      cartelaNumber: 12,
    };

    const validClaim = playerClaim(BingoClaimStatus.VALID);
    const validResult = {
      kind: 'auto_valid_open' as const,
      sessionId,
      slotId: 'slot-1',
      gameStatus: GameStatus.WINNER_WINDOW,
      userId,
      gameCartelaId,
      cartelaNumber: 12,
      claim: validClaim,
      winnerWindowEndsAt: new Date('2026-10-05T12:00:25.000Z'),
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
        claim: validClaim,
        progress: 1,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: '2026-10-05T12:00:25.000Z',
        reasonCode: null,
        retryAllowed: false,
        nextAutoCallAt: null,
      },
    };

    let txnCalls = 0;
    const prisma = {
      bingoClaim: {
        findUnique: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (fn: unknown) => {
        txnCalls += 1;
        if (txnCalls === 1) {
          // accept txn — durable attempt first
          emitOrder.push('accept_committed');
          if (typeof fn === 'function') {
            return acceptResult;
          }
          return acceptResult;
        }
        emitOrder.push('validation_committed');
        return validResult;
      }),
      gameSession: { findUnique: jest.fn() },
      gameCartela: { findUnique: jest.fn() },
    };

    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      {} as never,
      {
        emitToGame,
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
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
      { notifyWinnerWindowStarted: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: jest.fn(() => 'req-test') } as never,
    );

    // Bypass private accept by making $transaction ignore callback and return staged results.
    // claimBingo calls $transaction(async tx => accept...) then $transaction(async tx => validate...).
    (prisma.$transaction as jest.Mock).mockImplementation(async () => {
      txnCalls += 1;
      if (txnCalls === 1) {
        emitOrder.push('accept_committed');
        return acceptResult;
      }
      emitOrder.push('validation_committed');
      return validResult;
    });

    const response = await service.claimBingo(sessionId, userId, {
      gameCartelaId,
      claimAttemptId,
    });

    expect(emitOrder.indexOf('accept_committed')).toBeLessThan(
      emitOrder.indexOf('game:bingo_checking'),
    );
    expect(emitOrder.indexOf('game:bingo_checking')).toBeLessThan(
      emitOrder.indexOf('validation_committed'),
    );
    expect(emitToGame).toHaveBeenCalledWith(
      sessionId,
      'game:bingo_checking',
      expect.objectContaining({ claimAttemptId, gameCartelaId }),
    );
    expect(response).toMatchObject({
      isWinner: true,
      gameCartelaStatus: GameCartelaStatus.WINNER,
    });
  });

  it('returns same attempt for duplicate claimAttemptId without re-validation', async () => {
    const existing = playerClaim(BingoClaimStatus.FAILED);
    existing.failureCode = 'DB_TRANSACTION_TIMEOUT';
    existing.completedAt = new Date();

    const prisma = {
      bingoClaim: {
        findUnique: jest.fn(async () => existing),
      },
      gameCartela: {
        findUnique: jest.fn(async () => ({
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          gameSession: {
            status: GameStatus.PLAYING,
            nextAutoCallAt: new Date('2026-10-05T12:00:05.000Z'),
            winnerWindowEndsAt: null,
          },
        })),
      },
      $transaction: jest.fn(),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      {} as never,
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
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
      { notifyWinnerWindowStarted: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: jest.fn(() => 'req-test') } as never,
    );

    const response = await service.claimBingo(sessionId, userId, {
      gameCartelaId,
      claimAttemptId,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      retryAllowed: true,
      gameCartelaStatus: GameCartelaStatus.REGISTERED,
      claim: expect.objectContaining({
        claimAttemptId,
        status: BingoClaimStatus.FAILED,
      }),
    });
  });
});
