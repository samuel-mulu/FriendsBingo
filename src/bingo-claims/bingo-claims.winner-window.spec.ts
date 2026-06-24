import { ConflictException } from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { BingoClaimsService } from './bingo-claims.service';
import { splitPrizeAmount } from './prize-split.util';

function buildGameSessionMock(
  now: Date,
  overrides?: {
    status?: GameStatus;
    prizeAmount?: Prisma.Decimal;
    winnerWindowEndsAt?: Date | null;
    winnerCartelaId?: string | null;
    finishedAt?: Date | null;
    cartelaCount?: number;
  },
) {
  const prizeAmount = overrides?.prizeAmount ?? new Prisma.Decimal('10.00');

  return {
    id: 'session-1',
    gameSlotId: 'slot-1',
    playCode: 'BINGO-ABC123',
    entryFee: new Prisma.Decimal('10'),
    prizePerCartela: new Prisma.Decimal('8'),
    companyFeePerCartela: new Prisma.Decimal('2'),
    prizeAmount,
    companyRevenue: new Prisma.Decimal('20'),
    status: overrides?.status ?? GameStatus.FINISHED,
    autoCallEnabled: true,
    autoCallIntervalMs: 7000,
    nextAutoCallAt: null,
    startedAt: now,
    finishedAt: overrides?.finishedAt ?? now,
    winnerCartelaId: overrides?.winnerCartelaId ?? 'gc-1',
    winnerWindowStartedAt: now,
    winnerWindowEndsAt:
      overrides?.winnerWindowEndsAt ?? new Date(now.getTime() + 15_000),
    prizeFinalizedAt: now,
    createdAt: now,
    updatedAt: now,
    gameSlot: {
      id: 'slot-1',
      staticCode: 'ROWS-S1',
      name: 'Rows',
      gameType: 'ROWS',
      gameRuleId: 'rule-1',
      status: GameStatus.NEXT,
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      gameRule: {
        id: 'rule-1',
        key: 'ROWS',
        name: 'Rows',
        description: null,
        isActive: true,
        sortOrder: 1,
      },
    },
    gameCartelas: [],
    _count: {
      gameCartelas: overrides?.cartelaCount ?? 3,
      calledNumbers: 5,
    },
  };
}

describe('BingoClaimsService winner window finalization', () => {
  const now = new Date('2026-06-08T18:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createFinalizeService(options?: {
    winners?: Array<{ id: string; userId: string }>;
    prizeAmount?: Prisma.Decimal;
    lockCount?: number;
    finishCount?: number;
  }) {
    const winners = options?.winners ?? [
      { id: 'gc-1', userId: 'user-1' },
      { id: 'gc-2', userId: 'user-2' },
      { id: 'gc-3', userId: 'user-3' },
    ];
    const prizeAmount = options?.prizeAmount ?? new Prisma.Decimal('10.00');
    const credited: Array<{
      userId: string;
      amount: Prisma.Decimal;
      meta: Record<string, unknown>;
    }> = [];

    const tx = {
      gameSession: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: options?.lockCount ?? 1 })
          .mockResolvedValueOnce({ count: options?.finishCount ?? 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          playCode: 'BINGO-ABC123',
          prizeAmount,
          gameSlotId: 'slot-1',
          gameCartelas: winners,
        }),
      },
      gameSlot: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'gc-1',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: { number: 7 },
        }),
      },
      gameSession: {
        findUnique: jest.fn().mockResolvedValue(
          buildGameSessionMock(now, {
            prizeAmount,
            cartelaCount: winners.length,
          }),
        ),
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const walletService = {
      creditWallet: jest.fn(
        async (
          _tx: unknown,
          userId: string,
          amount: Prisma.Decimal,
          meta: Record<string, unknown>,
        ) => {
          credited.push({ userId, amount, meta });
        },
      ),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '100.00',
        lockedBalance: '0.00',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    };

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToUser: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameFinished: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const postGameRegistrationOpenerService = {
      openNextAutoQueueRegistration: jest.fn().mockResolvedValue(true),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {
        finishGameWithWinner: jest.fn(),
        emitSessionFinished: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        isManualRule: jest.fn().mockReturnValue(false),
        evaluate: jest.fn(),
      } as unknown as GameRuleEvaluationService,
      realtimeService as never,
      { create: jest.fn() } as never,
      walletService as never,
      { moveSlotToBack: jest.fn() } as never,
      new RequestPerformanceContext(),
      {
        getAutoCallIntervalMs: jest.fn().mockResolvedValue(7000),
        getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15_000),
        getWinnerWindowClaimGraceMs: jest.fn().mockResolvedValue(750),
      } as never,
      { invalidate: jest.fn() } as never,
      postGameRegistrationOpenerService as never,
    );

    return {
      service,
      tx,
      walletService,
      credited,
      winners,
      prizeAmount,
      postGameRegistrationOpenerService,
    };
  }

  it('splits prizeAmount exactly across winners and credits each wallet once', async () => {
    const prizeAmount = new Prisma.Decimal('10.00');
    const { service, walletService, credited } = createFinalizeService({
      prizeAmount,
    });

    const result = await service.finalizeWinnerWindow('session-1');

    expect(result).toEqual({
      sessionId: 'session-1',
      winnerUserIds: ['user-1', 'user-2', 'user-3'],
    });

    const expectedShares = splitPrizeAmount(prizeAmount, 3);
    expect(walletService.creditWallet).toHaveBeenCalledTimes(3);
    expectedShares.forEach((share, index) => {
      expect(walletService.creditWallet).toHaveBeenNthCalledWith(
        index + 1,
        expect.anything(),
        `user-${index + 1}`,
        share,
        {
          type: WalletTransactionType.PRIZE_WIN,
          referenceType: 'GAME_CARTELA',
          referenceId: `gc-${index + 1}`,
          description: 'Prize win for session BINGO-ABC123',
        },
      );
    });

    const totalPaid = credited.reduce(
      (sum, entry) => sum.plus(entry.amount),
      new Prisma.Decimal(0),
    );
    expect(totalPaid.toFixed(2)).toBe('10.00');
  });

  it('opens next registration immediately after winner window finalization', async () => {
    const { service, postGameRegistrationOpenerService } =
        createFinalizeService({});

    await service.finalizeWinnerWindow('session-1');

    expect(
      postGameRegistrationOpenerService.openNextAutoQueueRegistration,
    ).toHaveBeenCalledWith({ ignoreReviewGrace: true });
  });

  it('returns null when winner window was already finalized', async () => {
    const { service, walletService } = createFinalizeService({ lockCount: 0 });

    const result = await service.finalizeWinnerWindow('session-1');

    expect(result).toBeNull();
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });

  it('does not pay twice when finish guard fails after lock', async () => {
    const { service, walletService } = createFinalizeService({
      lockCount: 1,
      finishCount: 0,
    });

    await expect(
      service.finalizeWinnerWindow('session-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(walletService.creditWallet).toHaveBeenCalledTimes(3);
  });
});

describe('BingoClaimsService concurrent winner window open', () => {
  const now = new Date('2026-06-08T18:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('joins an existing window when another claim already opened it', async () => {
    const existingEndsAt = new Date(now.getTime() + 12_000);
    let sessionOpenAttempts = 0;

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'gc-2',
          gameSessionId: 'session-1',
          userId: 'user-2',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: {
            id: 'cartela-2',
            number: 8,
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
              gameType: 'ROWS',
              gameRule: { id: 'rule-1', key: 'ROWS', name: 'Rows' },
            },
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      calledNumber: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-1',
            gameSessionId: 'session-1',
            letter: 'B',
            number: 7,
            order: 1,
            createdAt: now,
          },
          {
            id: 'c-2',
            gameSessionId: 'session-1',
            letter: 'I',
            number: 22,
            order: 2,
            createdAt: now,
          },
          {
            id: 'c-3',
            gameSessionId: 'session-1',
            letter: 'N',
            number: 37,
            order: 3,
            createdAt: now,
          },
          {
            id: 'c-4',
            gameSessionId: 'session-1',
            letter: 'G',
            number: 56,
            order: 4,
            createdAt: now,
          },
          {
            id: 'c-5',
            gameSessionId: 'session-1',
            letter: 'O',
            number: 74,
            order: 5,
            createdAt: now,
          },
        ]),
      },
      gameSession: {
        updateMany: jest.fn().mockImplementation(async () => {
          sessionOpenAttempts += 1;
          return { count: 0 };
        }),
        findUnique: jest.fn().mockResolvedValue({
          status: GameStatus.WINNER_WINDOW,
          winnerWindowEndsAt: existingEndsAt,
        }),
      },
      bingoClaim: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'claim-2',
          gameSessionId: data.gameSessionId,
          userId: data.userId,
          gameCartelaId: data.gameCartelaId,
          status: data.status,
          checkedPattern: data.checkedPattern,
          reason: data.reason ?? null,
          reasonCode: data.reasonCode ?? null,
          createdAt: now,
          checkedAt: data.checkedAt ?? null,
          user: {
            id: data.userId,
            fullName: 'Player Two',
            phoneNumber: '0911111111',
          },
          gameSession: {
            id: 'session-1',
            playCode: 'BINGO-ABC123',
            status: GameStatus.WINNER_WINDOW,
            prizeAmount: new Prisma.Decimal('80'),
            gameSlot: {
              id: 'slot-1',
              gameType: 'ROWS',
              name: 'Rows',
              gameRule: { id: 'rule-1', key: 'ROWS', name: 'Rows' },
            },
          },
          gameCartela: {
            id: data.gameCartelaId,
            status: GameCartelaStatus.WINNER,
            isWinner: true,
            blockedAt: null,
            cartela: { id: 'cartela-2', number: 8 },
          },
        })),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'gc-2',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: { number: 8 },
        }),
      },
      gameSession: {
        findUnique: jest.fn().mockResolvedValue(
          buildGameSessionMock(now, {
            status: GameStatus.WINNER_WINDOW,
            winnerWindowEndsAt: existingEndsAt,
            finishedAt: null,
            prizeAmount: new Prisma.Decimal('80'),
          }),
        ),
      },
      gameSlot: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const gameRuleEvaluationService = {
      isManualRule: jest.fn().mockReturnValue(false),
      evaluate: jest.fn().mockReturnValue({
        isWinner: true,
        matchedPattern: 'ROWS:ROW_1',
        progress: 1,
        latestCalledNumber: 74,
        completedByLatestNumber: true,
        completedPatterns: [
          {
            type: 'ROW',
            key: 'ROW_1',
            numbers: [7, 22, 37, 56, 74],
          },
        ],
      }),
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
      { creditWallet: jest.fn(), getSerializedWallet: jest.fn() } as never,
      { moveSlotToBack: jest.fn() } as never,
      new RequestPerformanceContext(),
      {
        getAutoCallIntervalMs: jest.fn().mockResolvedValue(7000),
        getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15_000),
        getWinnerWindowClaimGraceMs: jest.fn().mockResolvedValue(750),
      } as never,
      { invalidate: jest.fn() } as never,
      {
        openNextAutoQueueRegistration: jest.fn().mockResolvedValue(false),
      } as never,
    );

    const result = await service.claimBingo('session-1', 'user-2', 'gc-2');

    expect(sessionOpenAttempts).toBe(2);
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
      }),
    });
    expect(result.claim.status).toBe(BingoClaimStatus.VALID);
    expect(result.gameStatus).toBe(GameStatus.WINNER_WINDOW);
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:winner_window_joined',
      expect.objectContaining({
        cartelaNumber: 8,
        winnerWindowEndsAt: existingEndsAt.toISOString(),
      }),
    );
  });

  it('accepts a join-window claim within the configured grace period', async () => {
    const existingEndsAt = new Date(now.getTime() - 500);
    const graceMs = 750;

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'gc-late',
          gameSessionId: 'session-1',
          userId: 'user-late',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: {
            id: 'cartela-late',
            number: 46,
            b: [7, 13, 10, 9, 4],
            i: [22, 20, 26, 18, 21],
            n: [37, 43, 'FREE', 41, 42],
            g: [56, 51, 57, 60, 53],
            o: [74, 64, 65, 72, 62],
          },
          gameSession: {
            id: 'session-1',
            playCode: 'BINGO-ABC123',
            status: GameStatus.WINNER_WINDOW,
            prizeAmount: new Prisma.Decimal('80'),
            autoCallEnabled: false,
            autoCallIntervalMs: 7000,
            nextAutoCallAt: null,
            winnerWindowEndsAt: existingEndsAt,
            gameSlot: {
              id: 'slot-1',
              gameType: 'ROWS',
              gameRule: {
                id: 'rule-1',
                key: 'ROWS',
                name: 'Rows',
                patterns: [],
              },
            },
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      calledNumber: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      bingoClaim: {
        create: jest.fn().mockResolvedValue({
          id: 'claim-late',
          status: BingoClaimStatus.VALID,
          checkedPattern: 'ROWS',
          reason: null,
          reasonCode: null,
          checkedAt: new Date(),
        }),
      },
      gameSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const gameRuleEvaluationService = {
      isManualRule: jest.fn().mockReturnValue(false),
      evaluate: jest.fn().mockReturnValue({
        isWinner: true,
        completedByLatestNumber: true,
        matchedPattern: 'ROWS',
        completedPatterns: [],
      }),
    };

    const service = new BingoClaimsService(
      {
        $transaction: jest.fn(async (cb) => cb(tx)),
        gameCartela: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'gc-late',
            status: GameCartelaStatus.REGISTERED,
            isWinner: false,
            cartela: { number: 46 },
          }),
        },
        gameSession: {
          findUnique: jest.fn().mockResolvedValue({
            autoCallEnabled: false,
            autoCallIntervalMs: 7000,
            nextAutoCallAt: null,
          }),
        },
      } as never,
      {} as never,
      gameRuleEvaluationService as never,
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      } as never,
      { create: jest.fn() } as never,
      { creditWallet: jest.fn() } as never,
      { moveSlotToBack: jest.fn() } as never,
      new RequestPerformanceContext(),
      {
        getAutoCallIntervalMs: jest.fn().mockResolvedValue(7000),
        getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15_000),
        getWinnerWindowClaimGraceMs: jest.fn().mockResolvedValue(graceMs),
      } as never,
      { invalidate: jest.fn() } as never,
      {
        openNextAutoQueueRegistration: jest.fn().mockResolvedValue(false),
      } as never,
    );

    const result = await service.claimBingo(
      'session-1',
      'user-late',
      'gc-late',
    );

    expect(result.isWinner).toBe(true);
    expect(result.gameStatus).toBe(GameStatus.WINNER_WINDOW);
  });
});
