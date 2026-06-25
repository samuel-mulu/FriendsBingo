import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { BingoClaimsService } from './bingo-claims.service';

const STANDARD_CARTELA = {
  id: 'cartela-1',
  number: 7,
  b: [7, 13, 10, 9, 4],
  i: [22, 20, 26, 18, 21],
  n: [37, 43, 'FREE', 41, 42],
  g: [56, 51, 57, 60, 53],
  o: [74, 64, 65, 72, 62],
};

const FULL_HOUSE_CALLED = [
  7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53, 74,
  64, 65, 72, 62,
];

const HALF_HOUSE_VALID_CALLED = [
  7, 22, 37, 56, 74, 13, 20, 43, 51, 64, 10, 26, 41, 57, 65,
];
const HALF_HOUSE_INVALID_CALLED = [7, 22, 37, 56, 74, 13, 20, 43, 51, 64];
const FULL_HOUSE_LATE_CALLED = [...FULL_HOUSE_CALLED, 75];
const HALF_HOUSE_LATE_CALLED = [...HALF_HOUSE_VALID_CALLED, 72];

function buildCalledRecords(numbers: number[], sessionId = 'session-1') {
  const letters = ['B', 'I', 'N', 'G', 'O'] as const;
  return numbers.map((number, index) => ({
    id: `called-${index + 1}`,
    gameSessionId: sessionId,
    letter: letters[index % letters.length],
    number,
    order: index + 1,
    createdAt: new Date('2026-06-08T18:00:00.000Z'),
  }));
}

describe('BingoClaimsService FULL_HOUSE and HALF_HOUSE', () => {
  const now = new Date('2026-06-08T18:00:00.000Z');
  const gameRuleEvaluationService = new GameRuleEvaluationService();

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createService(
    ruleKey: 'FULL_HOUSE' | 'HALF_HOUSE',
    calledNumbers: number[],
  ) {
    const cartela = {
      id: 'gc-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: STANDARD_CARTELA,
      gameSession: {
        id: 'session-1',
        playCode: 'BINGO-ABC123',
        status: GameStatus.PLAYING,
        prizeAmount: new Prisma.Decimal('80'),
        autoCallEnabled: true,
        autoCallIntervalMs: 7000,
        nextAutoCallAt: null,
        winnerWindowEndsAt: null,
        gameSlot: {
          id: 'slot-1',
          gameType: ruleKey,
          gameRule: {
            id: `rule-${ruleKey}`,
            key: ruleKey,
            name: ruleKey,
          },
        },
      },
    };

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(cartela),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      calledNumber: {
        findMany: jest
          .fn()
          .mockResolvedValue(buildCalledRecords(calledNumbers)),
      },
      gameSession: {
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
          autoCallIntervalMs: 7000,
          winnerWindowEndsAt: new Date(now.getTime() + 15_000),
        }),
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
          reasonCode: data.reasonCode ?? null,
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
            status:
              data.status === BingoClaimStatus.VALID
                ? GameStatus.WINNER_WINDOW
                : GameStatus.PLAYING,
            prizeAmount: new Prisma.Decimal('80'),
            gameSlot: {
              id: 'slot-1',
              gameType: ruleKey,
              name: ruleKey,
              gameRule: {
                id: `rule-${ruleKey}`,
                key: ruleKey,
                name: ruleKey,
              },
            },
          },
          gameCartela: {
            id: data.gameCartelaId,
            status:
              data.status === BingoClaimStatus.INVALID
                ? GameCartelaStatus.BLOCKED
                : data.status === BingoClaimStatus.VALID
                  ? GameCartelaStatus.WINNER
                  : GameCartelaStatus.REGISTERED,
            isWinner: data.status === BingoClaimStatus.VALID,
            blockedAt: data.status === BingoClaimStatus.INVALID ? now : null,
            cartela: {
              id: STANDARD_CARTELA.id,
              number: STANDARD_CARTELA.number,
            },
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
          id: cartela.id,
          status: cartela.status,
          isWinner: cartela.isWinner,
          cartela: { number: cartela.cartela.number },
        }),
      },
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
            staticCode: `${ruleKey}-S1`,
            name: ruleKey,
            gameType: ruleKey,
            status: GameStatus.PLAYING,
            entryFee: new Prisma.Decimal('10'),
            prizePerCartela: new Prisma.Decimal('8'),
            sortOrder: 1,
            createdAt: now,
            updatedAt: now,
            gameRule: {
              id: `rule-${ruleKey}`,
              key: ruleKey,
              name: ruleKey,
              description: null,
              isActive: true,
              sortOrder: 2,
            },
          },
          gameCartelas: [],
          _count: {
            gameCartelas: 1,
            calledNumbers: calledNumbers.length,
          },
        }),
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

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
      { restoreSlotAfterSession: jest.fn() } as never,
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

    return { service, tx, realtimeService };
  }

  it('FULL_HOUSE valid claim opens winner window', async () => {
    const { service, tx, realtimeService } = createService(
      'FULL_HOUSE',
      FULL_HOUSE_CALLED,
    );

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BingoClaimStatus.VALID,
          checkedPattern: 'FULL_HOUSE:ALL_ROWS',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.WINNER_WINDOW);
    expect(result.isWinner).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:winner_window_started',
      expect.objectContaining({
        winnerWindowEndsAt: new Date(now.getTime() + 15_000).toISOString(),
      }),
    );
  });

  it('FULL_HOUSE early claim blocks cartela and delays the next ball', async () => {
    const { service, tx } = createService('FULL_HOUSE', [7, 13, 10, 9, 4]);

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.gameSession.update).not.toHaveBeenCalled();
    expect(tx.gameSession.updateMany).toHaveBeenCalledWith({
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
          status: BingoClaimStatus.INVALID,
          reasonCode: 'INVALID_PATTERN',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.PLAYING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    expect(result.reasonCode).toBe('INVALID_PATTERN');
  });

  it('HALF_HOUSE valid claim opens winner window with three completed rows', async () => {
    const { service, realtimeService } = createService(
      'HALF_HOUSE',
      HALF_HOUSE_VALID_CALLED,
    );

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(result.gameStatus).toBe(GameStatus.WINNER_WINDOW);
    expect(result.isWinner).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:winner_window_started',
      expect.any(Object),
    );
  });

  it('HALF_HOUSE early claim blocks cartela and delays the next ball', async () => {
    const { service, tx } = createService(
      'HALF_HOUSE',
      HALF_HOUSE_INVALID_CALLED,
    );

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.gameSession.update).not.toHaveBeenCalled();
    expect(tx.gameSession.updateMany).toHaveBeenCalledWith({
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
          reasonCode: 'INVALID_PATTERN',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.PLAYING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    expect(result.reasonCode).toBe('INVALID_PATTERN');
  });

  it('FULL_HOUSE late claim is rejected when a later ball was called after the board was already complete', async () => {
    const { service, tx, realtimeService } = createService(
      'FULL_HOUSE',
      FULL_HOUSE_LATE_CALLED,
    );

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BingoClaimStatus.INVALID,
          reason:
            'Claim was too late because the latest called number did not complete the winning pattern',
          reasonCode: 'INVALID_LATE_CLAIM',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.PLAYING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    expect(result.reasonCode).toBe('INVALID_LATE_CLAIM');
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:bingo_invalid',
      expect.objectContaining({
        reasonCode: 'INVALID_LATE_CLAIM',
      }),
    );
  });

  it('HALF_HOUSE late claim is rejected when three rows were already complete before the latest ball', async () => {
    const { service, tx, realtimeService } = createService(
      'HALF_HOUSE',
      HALF_HOUSE_LATE_CALLED,
    );

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BingoClaimStatus.INVALID,
          reason:
            'Claim was too late because the latest called number did not complete the winning pattern',
          reasonCode: 'INVALID_LATE_CLAIM',
        }),
      }),
    );
    expect(result.gameStatus).toBe(GameStatus.PLAYING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    expect(result.reasonCode).toBe('INVALID_LATE_CLAIM');
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:bingo_invalid',
      expect.objectContaining({
        reasonCode: 'INVALID_LATE_CLAIM',
      }),
    );
  });
});
