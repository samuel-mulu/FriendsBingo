import { BadRequestException } from '@nestjs/common';
import {
  GameCartelaStatus,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { GamesService } from './games.service';

describe('GamesService', () => {
  function createSessionRecord(overrides?: Record<string, unknown>) {
    return {
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'BINGO-ABC123',
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      companyFeePerCartela: new Prisma.Decimal('2'),
      prizeAmount: new Prisma.Decimal('8'),
      companyRevenue: new Prisma.Decimal('2'),
      status: GameStatus.PLAYING,
      startedAt: new Date('2026-06-06T10:00:00.000Z'),
      finishedAt: null,
      winnerCartelaId: null,
      createdAt: new Date('2026-06-06T10:00:00.000Z'),
      updatedAt: new Date('2026-06-06T10:00:00.000Z'),
      gameSlot: {
        id: 'slot-1',
        staticCode: 'MANUAL-S1',
        name: 'Manual',
        gameType: 'MANUAL',
        gameRuleId: 'rule-1',
        status: GameStatus.PLAYING,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        sortOrder: 1,
        createdAt: new Date('2026-06-06T09:00:00.000Z'),
        updatedAt: new Date('2026-06-06T09:00:00.000Z'),
        gameRule: {
          id: 'rule-1',
          key: 'MANUAL',
          name: 'Manual',
          description: null,
          isActive: true,
          sortOrder: 1,
        },
      },
      _count: {
        gameCartelas: 1,
        calledNumbers: 0,
      },
      ...overrides,
    };
  }

  function createGameCartelaRecord() {
    return {
      id: 'gc-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      cartelaId: 'cartela-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      markedCells: null,
      blockedAt: null,
      createdAt: new Date('2026-06-06T10:02:00.000Z'),
      updatedAt: new Date('2026-06-06T10:02:00.000Z'),
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

  function createService() {
    const tx = {
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          playCode: 'BINGO-ABC123',
          entryFee: new Prisma.Decimal('10'),
          prizePerCartela: new Prisma.Decimal('8'),
          companyFeePerCartela: new Prisma.Decimal('2'),
          status: GameStatus.PLAYING,
        }),
        update: jest.fn().mockResolvedValue(createSessionRecord()),
        findFirst: jest.fn().mockResolvedValue(createSessionRecord()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      cartela: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cartela-1' }),
      },
      gameCartela: {
        create: jest.fn().mockResolvedValue(createGameCartelaRecord()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      gameSlot: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameSession: tx.gameSession,
      gameSlot: tx.gameSlot,
      gameCartela: tx.gameCartela,
    };

    const walletService = {
      debitWallet: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '90.00',
        lockedBalance: '0.00',
        createdAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-06-06T10:02:00.000Z').toISOString(),
      }),
    };

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitToUser: jest.fn(),
      emitToSlot: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    return {
      service: new GamesService(
        prisma as never,
        walletService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        {} as never,
      ),
      tx,
      walletService,
      realtimeService,
    };
  }

  it('debits 10 ETB, increases prize by 8, and company revenue by 2 on registration', async () => {
    const { service, tx, walletService, realtimeService } = createService();

    const result = await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(walletService.debitWallet).toHaveBeenCalledWith(
      tx,
      'user-1',
      expect.any(Prisma.Decimal),
      {
        type: WalletTransactionType.GAME_ENTRY,
        referenceType: 'SESSION',
        referenceId: 'session-1',
        description: 'Game entry fee for BINGO-ABC123',
      },
    );
    expect(tx.gameSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          prizeAmount: { increment: expect.any(Prisma.Decimal) },
          companyRevenue: { increment: expect.any(Prisma.Decimal) },
        },
      }),
    );

    const updatePayload = tx.gameSession.update.mock.calls[0][0].data;
    expect(updatePayload.prizeAmount.increment.toString()).toBe('8');
    expect(updatePayload.companyRevenue.increment.toString()).toBe('2');
    expect(result.status).toBe(GameCartelaStatus.REGISTERED);
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'session:prize_updated',
      expect.objectContaining({
        prizeAmount: '8',
        prizePerCartela: '8',
      }),
    );
    expect(
      (realtimeService.emitToGame as jest.Mock).mock.calls[0][2],
    ).not.toHaveProperty('companyRevenue');
    expect(realtimeService.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'wallet:updated',
      expect.any(Object),
    );
  });

  it('fails registration on insufficient balance and does not create a cartela', async () => {
    const { service, tx, walletService } = createService();
    walletService.debitWallet.mockRejectedValue(
      new BadRequestException('Insufficient wallet balance'),
    );

    await expect(
      service.registerCartela('session-1', 'user-1', {
        cartelaId: 'cartela-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.gameCartela.create).not.toHaveBeenCalled();
    expect(tx.gameSession.update).not.toHaveBeenCalled();
  });

  it('returns the active session directly from the live endpoint', async () => {
    const { service } = createService();

    const result = await service.getCurrentLiveSession();

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        playCode: 'BINGO-ABC123',
        entryFee: '10',
        prizePerCartela: '8',
        registrationOpen: true,
      }),
    );
    expect(result).not.toHaveProperty('companyFeePerCartela');
    expect(result).not.toHaveProperty('companyRevenue');
  });
});
