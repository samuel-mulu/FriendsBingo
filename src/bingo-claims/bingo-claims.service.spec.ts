import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  WalletTransactionType,
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
              code: 'FB-123456',
              gameType: 'HALF_HOUSE',
              prizeAmount: { toString: () => '500' },
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

    const walletService = {
      creditWallet: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '500',
        lockedBalance: '0',
        createdAt: checkedAt.toISOString(),
        updatedAt: checkedAt.toISOString(),
      }),
    };

    return {
      service: new BingoClaimsService(
        prisma as never,
        gameRulesService as never,
        gameEngineService as never,
        realtimeService as never,
        auditLogService as never,
        walletService as never,
      ),
      tx,
      gameRulesService,
      gameEngineService,
      realtimeService,
      auditLogService,
      walletService,
    };
  }

  it('marks a valid winner, finishes the game, and pays the prize once', async () => {
    const { service, tx, gameEngineService, walletService, realtimeService } =
      createService();

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
    expect(walletService.creditWallet).toHaveBeenCalledWith(
      tx,
      'user-1',
      expect.objectContaining({ toString: expect.any(Function) }),
      {
        type: WalletTransactionType.PRIZE_WIN,
        referenceType: 'GAME',
        referenceId: 'game-1',
        description: 'Prize win for game FB-123456',
      },
    );
    expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
    expect(walletService.getSerializedWallet).toHaveBeenCalledWith('user-1');
    expect(realtimeService.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'wallet:updated',
      expect.objectContaining({
        userId: 'user-1',
      }),
    );
    expect(result.claim.status).toBe(BingoClaimStatus.VALID);
    expect(result.gameStatus).toBe(GameStatus.FINISHED);
  });

  it('blocks an invalid winner claim and does not pay', async () => {
    const { service, tx, walletService } = createService({
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
    expect(walletService.creditWallet).not.toHaveBeenCalled();
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
          code: 'FB-123456',
          gameType: 'HALF_HOUSE',
          prizeAmount: { toString: () => '500' },
          status: GameStatus.PLAYING,
        },
      },
    });

    await expect(
      service.claimBingo('game-1', 'user-1', 'gc-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an already finished game and does not pay', async () => {
    const { service, walletService } = createService({
      gameCartela: {
        id: 'gc-1',
        gameId: 'game-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
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
          code: 'FB-123456',
          gameType: 'HALF_HOUSE',
          prizeAmount: { toString: () => '500' },
          status: GameStatus.FINISHED,
        },
      },
    });

    await expect(
      service.claimBingo('game-1', 'user-1', 'gc-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });

  it('rejects a simultaneous winner attempt after another cartela finishes the game and only pays one winner', async () => {
    const { service, walletService } = createService({
      finishGameWithWinner: false,
    });

    await expect(
      service.claimBingo('game-1', 'user-1', 'gc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });
});
