import { GameCartelaStatus, GameStatus, Prisma } from '@prisma/client';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { BingoClaimsService } from './bingo-claims.service';

describe('BingoClaimsService automatic rules', () => {
  const now = new Date('2026-06-08T18:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createAutoCartela(ruleKey = 'ROWS') {
    return {
      id: 'gc-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: {
        id: 'cartela-1',
        number: 7,
        b: [7, 13, 10, 9, 4],
        i: [22, 20, 26, 18, 21],
        n: [37, 43, 'FREE', 41, 42],
        g: [56, 51, 57, 60, 53],
        o: [74, 64, 65, 72, 62],
      },
      gameSession: {
        id: 'session-1',
        playCode: 'BINGO-ABC123',
        status: GameStatus.PLAYING,
        prizeAmount: new Prisma.Decimal('80'),
        autoCallEnabled: true,
        winnerWindowEndsAt: null,
        gameSlot: {
          id: 'slot-1',
          gameType: ruleKey,
          gameRule: {
            id: 'rule-1',
            key: ruleKey,
            name: ruleKey,
          },
        },
      },
    };
  }

  function createService(options?: {
    cartela?: Record<string, unknown> | null;
    evaluation?: { isWinner: boolean; matchedPattern: string; progress: number };
    calledNumbers?: Array<Record<string, unknown>>;
  }) {
    const cartela = options?.cartela ?? createAutoCartela();
    const evaluation = options?.evaluation ?? {
      isWinner: false,
      matchedPattern: 'ROWS:NONE',
      progress: 0,
    };

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(cartela),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      calledNumber: {
        findMany: jest.fn().mockResolvedValue(options?.calledNumbers ?? []),
      },
      gameSession: {
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'session-1',
          gameSlotId: 'slot-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
          autoCallIntervalMs: 7000,
          winnerWindowEndsAt: new Date(now.getTime() + 15_000),
        })),
      },
      gameSlot: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      bingoClaim: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'claim-1',
          gameSessionId: data.gameSessionId,
          userId: data.userId,
          gameCartelaId: data.gameCartelaId,
          status: data.status,
          checkedPattern: data.checkedPattern,
          reason: data.reason ?? null,
          createdAt: now,
          checkedAt: data.checkedAt ?? null,
          user: {
            id: data.userId,
            fullName: 'Player One',
            phoneNumber: '0912345678',
          },
          gameSession: {
            id: 'session-1',
            playCode: 'BINGO-ABC123',
            status: data.status === 'VALID' ? GameStatus.WINNER_WINDOW : GameStatus.PLAYING,
            prizeAmount: new Prisma.Decimal('80'),
            gameSlot: {
              id: 'slot-1',
              gameType: 'ROWS',
              name: 'Rows',
              gameRule: {
                id: 'rule-1',
                key: 'ROWS',
                name: 'Rows',
              },
            },
          },
          gameCartela: {
            id: data.gameCartelaId,
            status:
              data.status === 'INVALID'
                ? GameCartelaStatus.BLOCKED
                : data.status === 'VALID'
                  ? GameCartelaStatus.WINNER
                  : GameCartelaStatus.REGISTERED,
            isWinner: data.status === 'VALID',
            blockedAt: data.status === 'INVALID' ? now : null,
            cartela: {
              id: 'cartela-1',
              number: 7,
            },
          },
        })),
        findUnique: jest.fn(),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          gameSlotId: 'slot-1',
          playCode: 'BINGO-ABC123',
          status: GameStatus.WINNER_WINDOW,
          entryFee: new Prisma.Decimal('10'),
          prizePerCartela: new Prisma.Decimal('8'),
          companyFeePerCartela: new Prisma.Decimal('2'),
          prizeAmount: new Prisma.Decimal('80'),
          companyRevenue: new Prisma.Decimal('20'),
          autoCallEnabled: false,
          autoCallIntervalMs: 7000,
          nextAutoCallAt: null,
          winnerWindowStartedAt: now,
          winnerWindowEndsAt: new Date(now.getTime() + 15_000),
          prizeFinalizedAt: null,
          startedAt: now,
          finishedAt: null,
          winnerCartelaId: 'gc-1',
          createdAt: now,
          updatedAt: now,
          gameSlot: {
            id: 'slot-1',
            staticCode: 'ROWS-S1',
            name: 'Rows',
            gameType: 'ROWS',
            status: GameStatus.PLAYING,
            entryFee: new Prisma.Decimal('10'),
            prizePerCartela: new Prisma.Decimal('8'),
            sortOrder: 1,
            gameRule: {
              id: 'rule-1',
              key: 'ROWS',
              name: 'Rows',
            },
          },
          _count: {
            gameCartelas: 1,
            calledNumbers: 5,
          },
        }),
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const gameRuleEvaluationService = {
      isManualRule: jest.fn((key: string) => key === 'MANUAL'),
      evaluate: jest.fn().mockReturnValue(evaluation),
    } as unknown as GameRuleEvaluationService;

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToUser: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
      emitGameFinished: jest.fn(),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {
        finishGameWithWinner: jest.fn(),
        emitSessionFinished: jest.fn().mockResolvedValue(undefined),
      } as never,
      gameRuleEvaluationService,
      realtimeService as never,
      { create: jest.fn() } as never,
      {
        creditWallet: jest.fn(),
        getSerializedWallet: jest.fn(),
      } as never,
      { moveSlotToBack: jest.fn() } as never,
      new RequestPerformanceContext(),
      {
        getAutoCallIntervalMs: jest.fn().mockResolvedValue(7000),
        getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15_000),
      } as never,
      { invalidate: jest.fn() } as never,
    );

    return { service, tx, realtimeService, gameRuleEvaluationService };
  }

  it('auto-invalid claim blocks cartela, keeps session PLAYING, and delays the next ball', async () => {
    const { service, tx, realtimeService } = createService();

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    // Pause auto-call immediately, then push the next ball back after rejection.
    expect(tx.gameSession.update).not.toHaveBeenCalled();
    expect(tx.gameSession.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.gameSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
      },
      data: {
        nextAutoCallAt: null,
      },
    });
    expect(tx.gameSession.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
      },
      data: {
        nextAutoCallAt: new Date(now.getTime() + 7000),
      },
    });
    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'INVALID',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.PLAYING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:bingo_invalid',
      expect.any(Object),
    );
  });

  it('auto-valid claim opens winner window without moving to CHECKING', async () => {
    const { service, tx, realtimeService } = createService({
      evaluation: {
        isWinner: true,
        matchedPattern: 'ROWS:ROW_1',
        progress: 1,
      },
    });

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    // Pause auto-call immediately, then open the winner window in one transition.
    expect(tx.gameSession.update).not.toHaveBeenCalled();
    expect(tx.gameSession.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.gameSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
      },
      data: {
        nextAutoCallAt: null,
      },
    });
    expect(tx.gameSession.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'session-1',
        status: GameStatus.PLAYING,
      },
      data: expect.objectContaining({
        status: GameStatus.WINNER_WINDOW,
        autoCallEnabled: false,
      }),
    });
    expect(result.gameStatus).toBe(GameStatus.WINNER_WINDOW);
    expect(result.isWinner).toBe(true);
    expect(result.winnerWindowEndsAt).toBe(
      new Date(now.getTime() + 15_000).toISOString(),
    );
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:winner_window_started',
      expect.objectContaining({
        winnerWindowEndsAt: new Date(
          now.getTime() + 15_000,
        ).toISOString(),
      }),
    );
  });
});
