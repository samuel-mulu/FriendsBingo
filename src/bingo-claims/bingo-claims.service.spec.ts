import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
} from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

describe('BingoClaimsService', () => {
  const checkedAt = new Date('2026-06-02T10:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(checkedAt);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createService(overrides?: {
    gameCartela?: Record<string, unknown>;
    calledNumbers?: Array<Record<string, unknown>>;
    evaluation?: {
      isWinner: boolean;
      matchedPattern: string;
      progress: number;
    };
    finishGameWithWinner?: boolean;
  }) {
    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(
          overrides?.gameCartela ?? {
            id: 'gc-1',
            gameId: 'game-1',
            userId: 'user-1',
            status: GameCartelaStatus.REGISTERED,
            isWinner: false,
            cartela: {
              id: 'cartela-1',
              number: 7,
              b: [1, 2, 3, 4, 5],
              i: [6, 7, 8, 9, 10],
              n: [11, 12, 13, 14, 15],
              g: [16, 17, 18, 19, 20],
              o: [21, 22, 23, 24, 25],
            },
            game: {
              id: 'game-1',
              gameType: 'HALF_HOUSE',
              status: GameStatus.PLAYING,
            },
          },
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      calledNumber: {
        findMany: jest.fn().mockResolvedValue(
          overrides?.calledNumbers ?? [
            {
              id: 'cn-1',
              gameId: 'game-1',
              letter: 'B',
              number: 1,
              order: 1,
              createdAt: checkedAt,
            },
          ],
        ),
      },
      bingoClaim: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'claim-1',
          gameId: data.gameId,
          userId: data.userId,
          gameCartelaId: data.gameCartelaId,
          status: data.status,
          checkedPattern: data.checkedPattern,
          reason: data.reason,
          createdAt: checkedAt,
          checkedAt,
        })),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const gameRulesService = {
      evaluate: jest.fn().mockReturnValue(
        overrides?.evaluation ?? {
          isWinner: true,
          matchedPattern: 'HALF_HOUSE:ROW_1,ROW_2,ROW_3',
          progress: 1,
        },
      ),
    };

    const gameEngineService = {
      finishGameWithWinner: jest
        .fn()
        .mockResolvedValue(overrides?.finishGameWithWinner ?? true),
    };

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToUser: jest.fn(),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new BingoClaimsService(
        prisma as never,
        gameRulesService as never,
        gameEngineService as never,
        realtimeService as never,
        auditLogService as never,
      ),
      tx,
      gameRulesService,
      gameEngineService,
      realtimeService,
      auditLogService,
    };
  }

  it('marks a valid winner and finishes the game', async () => {
    const { service, tx, gameEngineService } = createService();

    const result = await service.claimBingo('game-1', 'user-1', 'gc-1');

    expect(tx.gameCartela.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameCartelaStatus.WINNER,
          isWinner: true,
        }),
      }),
    );
    expect(gameEngineService.finishGameWithWinner).toHaveBeenCalled();
    expect(result.claim.status).toBe(BingoClaimStatus.VALID);
    expect(result.gameStatus).toBe(GameStatus.FINISHED);
  });

  it('blocks an invalid winner claim', async () => {
    const { service, tx } = createService({
      evaluation: {
        isWinner: false,
        matchedPattern: 'HALF_HOUSE:ROW_1',
        progress: 0.33,
      },
    });

    const result = await service.claimBingo('game-1', 'user-1', 'gc-1');

    expect(tx.gameCartela.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameCartelaStatus.BLOCKED,
        }),
      }),
    );
    expect(result.claim.status).toBe(BingoClaimStatus.INVALID);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
  });

  it('rejects blocked cartelas', async () => {
    const { service } = createService({
      gameCartela: {
        id: 'gc-1',
        gameId: 'game-1',
        userId: 'user-1',
        status: GameCartelaStatus.BLOCKED,
        isWinner: false,
        cartela: {
          id: 'cartela-1',
          number: 7,
          b: [],
          i: [],
          n: [],
          g: [],
          o: [],
        },
        game: {
          id: 'game-1',
          gameType: 'HALF_HOUSE',
          status: GameStatus.PLAYING,
        },
      },
    });

    await expect(
      service.claimBingo('game-1', 'user-1', 'gc-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a simultaneous winner attempt after another cartela finishes the game', async () => {
    const { service } = createService({
      finishGameWithWinner: false,
    });

    await expect(
      service.claimBingo('game-1', 'user-1', 'gc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
