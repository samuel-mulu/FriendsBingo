import { BadRequestException } from '@nestjs/common';
import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCartelaStatus,
  GameCategory,
  GameOperationMode,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { GamesService } from './games.service';

function createOperationsCacheServiceMock() {
  return {
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
    invalidate: jest.fn(),
  };
}

describe('GamesService bonus cartela wallet', () => {
  function createGameCartelaRecord(
    overrides?: Partial<{
      id: string;
      paymentSource: CartelaPaymentSource | null;
    }>,
  ) {
    return {
      id: overrides?.id ?? 'gc-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      cartelaId: 'cartela-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      markedCells: null,
      blockedAt: null,
      paymentSource:
        overrides?.paymentSource ?? CartelaPaymentSource.BONUS_CARTELA,
      entryFeeCents: 1000,
      prizeContributionCents: 800,
      companyFeeCents: 200,
      companyFeeSource: CompanyFeeSource.BONUS,
      createdAt: new Date('2026-07-02T10:02:00.000Z'),
      updatedAt: new Date('2026-07-02T10:02:00.000Z'),
      cartela: {
        id: 'cartela-1',
        number: 12,
        b: [],
        i: [],
        n: [],
        g: [],
        o: [],
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    };
  }

  function createService(options?: {
    bonusCartelaBalance?: number;
    walletBalance?: string;
    trackBonusBalance?: boolean;
  }) {
    const bonusCartelaBalance = options?.bonusCartelaBalance ?? 10;
    const walletBalance = options?.walletBalance ?? '100';
    let currentBonusBalance = bonusCartelaBalance;

    const tx = {
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          playCode: 'BINGO-ABC123',
          entryFee: new Prisma.Decimal('10'),
          prizePerCartela: new Prisma.Decimal('8'),
          companyFeePerCartela: new Prisma.Decimal('2'),
          status: GameStatus.PLAYING,
          registrationOpensAt: null,
          scheduledStartAt: null,
          gameSlot: {
            operationMode: GameOperationMode.MANUAL,
            category: GameCategory.NORMAL,
            maxCartelasPerPlayer: null,
          },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'session-1',
          prizeAmount: new Prisma.Decimal('8'),
          companyRevenue: new Prisma.Decimal('2'),
          _count: { gameCartelas: 1 },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      cartela: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cartela-1' }),
      },
      gameCartela: {
        create: jest.fn().mockImplementation(async ({ data }) =>
          createGameCartelaRecord({
            id: 'gc-new',
            paymentSource: data.paymentSource ?? null,
          }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      gameCartelaReservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-1',
          userId: 'user-1',
          balance: new Prisma.Decimal(walletBalance),
          lockedBalance: new Prisma.Decimal('0'),
          bonusCartelaBalance,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameSession: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const walletService = {
      getWalletOrThrow: jest.fn(async () => ({
        id: 'wallet-1',
        userId: 'user-1',
        balance: new Prisma.Decimal(walletBalance),
        lockedBalance: new Prisma.Decimal('0'),
        bonusCartelaBalance: currentBonusBalance,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      consumeBonusCartela: jest.fn(async () => {
        if (currentBonusBalance < 1) {
          throw new BadRequestException('Insufficient bonus cartela balance');
        }
        currentBonusBalance -= 1;
        return {
          id: 'wallet-1',
          userId: 'user-1',
          balance: new Prisma.Decimal(walletBalance),
          lockedBalance: new Prisma.Decimal('0'),
          bonusCartelaBalance: currentBonusBalance,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
      debitWallet: jest.fn(),
      creditBonusCartelas: jest.fn(),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: walletBalance,
        lockedBalance: '0',
        bonusCartelaBalance: currentBonusBalance,
        totalBalance: walletBalance,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    };

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitToUser: jest.fn(),
      emitToSlot: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
      emitSessionCartelasUpdated: jest.fn(),
    };

    const userActionRateLimitService = {
      assertWithinLimit: jest.fn(),
    };

    const gameTimingConfigService = {
      getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
      getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(7),
      getCartelaHoldMs: jest.fn().mockResolvedValue(10_000),
      getBulkSelectionHoldMs: jest.fn().mockResolvedValue(120_000),
      getPlayerConfig: jest.fn().mockResolvedValue({
        cartelaHoldSeconds: 10,
        finishedResultDisplaySeconds: 3,
        preparingDisplayMaxSeconds: null,
        missedNumberAnimationMs: 150,
        missedNumberStaggerMaxBalls: 10,
        flutterRefetchDebounceMs: 400,
      }),
    };

    const service = new GamesService(
      prisma as never,
      walletService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      realtimeService as never,
      { create: jest.fn() } as never,
      {} as never,
      { cancelSession: jest.fn() } as never,
      {} as never,
      userActionRateLimitService as never,
      new RequestPerformanceContext(),
      createOperationsCacheServiceMock() as never,
      gameTimingConfigService as never,
      {
        ensureAutoReadySessionHasCountdown: jest.fn(),
        repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
      } as never,
    );

    return { service, tx, walletService, getCurrentBonusBalance: () => currentBonusBalance };
  }

  it('registers with bonus cartela when balance is available', async () => {
    const { service, walletService } = createService({
      bonusCartelaBalance: 10,
    });

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(walletService.consumeBonusCartela).toHaveBeenCalled();
    expect(walletService.debitWallet).not.toHaveBeenCalled();
  });

  it('registers with money wallet when bonus balance is zero', async () => {
    const { service, walletService } = createService({
      bonusCartelaBalance: 0,
    });

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(walletService.debitWallet).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.any(Prisma.Decimal),
      expect.objectContaining({
        type: WalletTransactionType.GAME_ENTRY,
        referenceType: 'GAME_CARTELA',
      }),
    );
    expect(walletService.consumeBonusCartela).not.toHaveBeenCalled();
  });

  it('fails registration when bonus and wallet balance are insufficient', async () => {
    const { service, walletService } = createService({
      bonusCartelaBalance: 0,
      walletBalance: '0',
    });
    walletService.debitWallet.mockRejectedValue(
      new BadRequestException('Insufficient wallet balance'),
    );

    await expect(
      service.registerCartela('session-1', 'user-1', {
        cartelaId: 'cartela-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records BONUS_CARTELA payment source on bonus registration', async () => {
    const { service, tx } = createService({ bonusCartelaBalance: 9 });

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(tx.gameCartela.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentSource: CartelaPaymentSource.BONUS_CARTELA,
          entryFeeCents: 1000,
          companyFeeSource: CompanyFeeSource.BONUS,
        }),
      }),
    );
  });

  it('records MONEY_WALLET payment source on paid registration', async () => {
    const { service, tx } = createService({ bonusCartelaBalance: 0 });

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(tx.gameCartela.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentSource: CartelaPaymentSource.MONEY_WALLET,
          companyFeeSource: CompanyFeeSource.MONEY,
        }),
      }),
    );
  });

  it('uses bonus cartelas before money wallet across repeated registrations', async () => {
    const { service, tx, walletService, getCurrentBonusBalance } =
      createService({
        bonusCartelaBalance: 10,
      });
    let cartelaCounter = 1;
    tx.gameCartela.create.mockImplementation(async ({ data }) =>
      createGameCartelaRecord({
        id: `gc-${cartelaCounter++}`,
        paymentSource: data.paymentSource ?? null,
      }),
    );
    tx.cartela.findUnique.mockImplementation(async ({ where }) => ({
      id: where.id,
    }));

    for (let index = 0; index < 10; index += 1) {
      await service.registerCartela('session-1', 'user-1', {
        cartelaId: `cartela-${index + 1}`,
      });
    }

    expect(walletService.consumeBonusCartela).toHaveBeenCalledTimes(10);
    expect(walletService.debitWallet).not.toHaveBeenCalled();
    expect(getCurrentBonusBalance()).toBe(0);

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-11',
    });

    expect(walletService.debitWallet).toHaveBeenCalledTimes(1);
  });

  it('does not use bonus cartelas for Big GOTD registration', async () => {
    const { service, walletService, tx } = createService({
      bonusCartelaBalance: 10,
    });
    tx.gameSession.findUnique.mockResolvedValue({
      id: 'session-1',
      playCode: 'BINGO-ABC123',
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      companyFeePerCartela: new Prisma.Decimal('2'),
      status: GameStatus.PLAYING,
      registrationOpensAt: null,
      scheduledStartAt: null,
      gameSlot: {
        operationMode: GameOperationMode.MANUAL,
        category: GameCategory.BIG_GOTD,
        maxCartelasPerPlayer: 5,
      },
    });

    await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(walletService.consumeBonusCartela).not.toHaveBeenCalled();
    expect(walletService.debitWallet).toHaveBeenCalled();
  });
});
