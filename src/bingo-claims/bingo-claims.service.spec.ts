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
  const now = new Date('2026-06-04T18:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createPendingClaim(overrides?: Record<string, unknown>) {
    return {
      id: 'claim-1',
      gameId: 'game-1',
      userId: 'user-1',
      gameCartelaId: 'gc-1',
      status: BingoClaimStatus.PENDING,
      checkedPattern: 'MANUAL',
      reason: 'Waiting for admin confirmation',
      createdAt: now,
      checkedAt: null,
      user: {
        id: 'user-1',
        fullName: 'Player One',
        phoneNumber: '0912345678',
      },
      game: {
        id: 'game-1',
        code: 'FB-123456',
        status: GameStatus.CHECKING,
        prizeAmount: { toString: () => '500' },
        gameRule: {
          id: 'rule-1',
          key: 'MANUAL',
          name: 'Manual',
        },
      },
      gameCartela: {
        id: 'gc-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        blockedAt: null,
        cartela: {
          id: 'cartela-1',
          number: 7,
        },
      },
      ...overrides,
    };
  }

  function createGameSummary(overrides?: Record<string, unknown>) {
    return {
      id: 'game-1',
      code: 'FB-123456',
      name: 'Manual',
      gameType: 'MANUAL',
      gameRuleId: 'rule-1',
      entryFee: { toString: () => '10' },
      prizeAmount: { toString: () => '500' },
      status: GameStatus.FINISHED,
      startsAt: new Date('2026-06-04T17:30:00.000Z'),
      playOrder: 1,
      startedAt: new Date('2026-06-04T18:00:00.000Z'),
      finishedAt: now,
      winnerCartelaId: 'gc-1',
      createdAt: new Date('2026-06-04T12:00:00.000Z'),
      updatedAt: now,
      gameRule: {
        id: 'rule-1',
        key: 'MANUAL',
        name: 'Manual',
        description: null,
        isActive: true,
        sortOrder: 1,
      },
      _count: {
        gameCartelas: 10,
      },
      ...overrides,
    };
  }

  function createService(overrides?: {
    playerCartela?: Record<string, unknown> | null;
    existingPendingClaim?: Record<string, unknown> | null;
    claimRecord?: Record<string, unknown> | null;
    updatedClaim?: Record<string, unknown>;
    finishGameWithWinner?: boolean;
    updatedGame?: Record<string, unknown> | null;
  }) {
    const playerCartela =
      overrides?.playerCartela ??
      ({
        id: 'gc-1',
        gameId: 'game-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: {
          id: 'cartela-1',
          number: 7,
        },
        game: {
          id: 'game-1',
          code: 'FB-123456',
          status: GameStatus.PLAYING,
          gameRule: {
            id: 'rule-1',
            key: 'MANUAL',
            name: 'Manual',
          },
        },
      } as Record<string, unknown>);

    const pendingClaim = createPendingClaim(overrides?.claimRecord);
    const validClaim = createPendingClaim({
      ...overrides?.updatedClaim,
      status: BingoClaimStatus.VALID,
      reason: null,
      checkedAt: now,
    });

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(playerCartela),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      game: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      bingoClaim: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides?.existingPendingClaim ?? null),
        findUnique: jest
          .fn()
          .mockResolvedValue(overrides?.claimRecord === null ? null : pendingClaim),
        create: jest.fn().mockImplementation(async ({ data }) =>
          createPendingClaim({
            gameId: data.gameId,
            userId: data.userId,
            gameCartelaId: data.gameCartelaId,
            status: data.status,
            checkedPattern: data.checkedPattern,
            reason: data.reason,
          }),
        ),
        update: jest
          .fn()
          .mockImplementation(async ({ data }) =>
            data.status === BingoClaimStatus.VALID
              ? validClaim
              : createPendingClaim({
                  ...overrides?.updatedClaim,
                  status: BingoClaimStatus.INVALID,
                  reason: data.reason,
                  checkedAt: now,
                }),
          ),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      game: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides?.updatedGame === null
              ? null
              : createGameSummary(overrides?.updatedGame),
          ),
      },
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
      emitToPublicGames: jest.fn(),
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
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    };

    return {
      service: new BingoClaimsService(
        prisma as never,
        gameEngineService as never,
        realtimeService as never,
        auditLogService as never,
        walletService as never,
      ),
      tx,
      prisma,
      gameEngineService,
      realtimeService,
      auditLogService,
      walletService,
    };
  }

  it('creates a pending bingo claim for manual review', async () => {
    const { service, tx, walletService, realtimeService } = createService();

    const result = await service.claimBingo('game-1', 'user-1', 'gc-1');

    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BingoClaimStatus.PENDING,
          checkedPattern: 'MANUAL',
        }),
      }),
    );
    expect(result.claim.status).toBe(BingoClaimStatus.PENDING);
    expect(result.gameStatus).toBe(GameStatus.CHECKING);
    expect(result.gameCartelaStatus).toBe(GameCartelaStatus.REGISTERED);
    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { status: GameStatus.CHECKING },
    });
    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'game-1',
      'game:bingo_claimed',
      expect.objectContaining({
        status: BingoClaimStatus.PENDING,
      }),
    );
  });

  it('approves a pending claim and pays the prize once', async () => {
    const { service, tx, gameEngineService, walletService, realtimeService } =
      createService();

    const result = await service.approveClaim('claim-1', 'admin-1');

    expect(tx.gameCartela.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameCartelaStatus.WINNER,
          isWinner: true,
        }),
      }),
    );
    expect(gameEngineService.finishGameWithWinner).toHaveBeenCalledWith(
      tx,
      'game-1',
      'gc-1',
      now,
    );
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
    expect(result.status).toBe(BingoClaimStatus.VALID);
    expect(realtimeService.emitToPublicGames).toHaveBeenCalledWith(
      'game:finished',
      expect.objectContaining({
        gameId: 'game-1',
      }),
    );
  });

  it('rejects a pending claim and blocks the cartela without paying', async () => {
    const { service, tx, walletService, realtimeService } = createService();

    const result = await service.rejectClaim(
      'claim-1',
      { reason: 'Numbers did not match' },
      'admin-1',
    );

    expect(tx.gameCartela.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameCartelaStatus.BLOCKED,
        }),
      }),
    );
    expect(result.status).toBe(BingoClaimStatus.INVALID);
    expect(result.reason).toBe('Numbers did not match');
    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { status: GameStatus.PLAYING },
    });
    expect(realtimeService.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'game:bingo_invalid',
      expect.objectContaining({
        claimId: 'claim-1',
      }),
    );
  });

  it('does not pay when the game is already finished', async () => {
    const { service, walletService } = createService({
      claimRecord: {
        game: {
          ...createPendingClaim().game,
          status: GameStatus.FINISHED,
        },
      },
    });

    await expect(service.approveClaim('claim-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });

  it('only pays one winner when another approval already finished the game', async () => {
    const { service, walletService } = createService({
      finishGameWithWinner: false,
    });

    await expect(service.approveClaim('claim-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });
});
