import { BadRequestException } from '@nestjs/common';
import {
  GameCartelaStatus,
  GameStatus,
  Prisma,
  UserRole,
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

  function createGameCartelaRecord(
    overrides?: Partial<{
      id: string;
      userId: string;
      cartelaId: string;
      cartelaNumber: number;
    }>,
  ) {
    return {
      id: overrides?.id ?? 'gc-1',
      gameSessionId: 'session-1',
      userId: overrides?.userId ?? 'user-1',
      cartelaId: overrides?.cartelaId ?? 'cartela-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      markedCells: null,
      blockedAt: null,
      createdAt: new Date('2026-06-06T10:02:00.000Z'),
      updatedAt: new Date('2026-06-06T10:02:00.000Z'),
      cartela: {
        id: overrides?.cartelaId ?? 'cartela-1',
        number: overrides?.cartelaNumber ?? 12,
        b: [],
        i: [],
        n: [],
        g: [],
        o: [],
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    };
  }

  function createSlotRecord(
    slotId: string,
    sortOrder: number,
    status: GameStatus = GameStatus.NEXT,
  ) {
    return {
      id: slotId,
      staticCode: `MANUAL-${slotId}`,
      name: 'Manual',
      gameType: 'MANUAL',
      status,
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      sortOrder,
      gameRule: {
        id: 'rule-1',
        name: 'Manual',
        key: 'MANUAL',
      },
      sessions: [],
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
      emitToSession: jest.fn(),
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
        {} as never,
      ),
      prisma,
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

  it('delegates the legacy live endpoint to canonical operations selection', async () => {
    const { service, prisma } = createService();
    const playingSession = createSessionRecord({
      id: 'session-1',
      status: GameStatus.PLAYING,
      gameCartelas: [],
      gameSlot: {
        ...createSessionRecord().gameSlot,
        id: 'slot-1',
        sortOrder: 1,
        status: GameStatus.PLAYING,
      },
    });

    prisma.gameSession.findMany.mockResolvedValue([playingSession]);
    prisma.gameSlot.findMany.mockResolvedValue([]);
    prisma.gameSession.findUnique.mockResolvedValue(playingSession);

    const [legacyResult, operationsResult] = await Promise.all([
      service.getCurrentLiveSession('user-1'),
      service.getCurrentOperations('user-1', UserRole.PLAYER),
    ]);

    expect(legacyResult).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        playCode: 'BINGO-ABC123',
        entryFee: '10',
        prizePerCartela: '8',
        registrationOpen: true,
      }),
    );
    expect(legacyResult?.sessionId).toBe(operationsResult.liveGame?.sessionId);
    expect(operationsResult.checkingGame).toBeNull();
    expect(operationsResult.registrationOpenGame).toBeNull();
    expect(legacyResult?.id ?? legacyResult?.sessionId).toBeTruthy();
  });

  describe('getCurrentOperations', () => {
    function createOperationsService(
      activeSessions: ReturnType<typeof createSessionRecord>[],
      nextSlots: ReturnType<typeof createSlotRecord>[] = [],
    ) {
      const { service, prisma } = createService();
      prisma.gameSession.findMany.mockResolvedValue(activeSessions);
      prisma.gameSlot.findMany.mockResolvedValue(nextSlots);
      return service;
    }

    it('selects PLAYING by slot sortOrder even when READY/NEXT have lower sortOrder', async () => {
      const service = createOperationsService([
        createSessionRecord({
          id: 'session-playing',
          status: GameStatus.PLAYING,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            id: 'slot-playing',
            sortOrder: 3,
            status: GameStatus.PLAYING,
          },
        }),
        createSessionRecord({
          id: 'session-ready',
          status: GameStatus.READY,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            id: 'slot-ready',
            sortOrder: 1,
            status: GameStatus.READY,
          },
        }),
      ], [createSlotRecord('slot-next', 2)]);

      const result = await service.getCurrentOperations('user-1', UserRole.PLAYER);

      expect(result.liveGame?.slotId).toBe('slot-playing');
      expect(result.registrationOpenGame?.slotId).toBe('slot-ready');
      expect(result.queue.map((item) => item.slotId)).toEqual(['slot-next']);
    });

    it('places CHECKING in checkingGame by slot sortOrder', async () => {
      const service = createOperationsService([
        createSessionRecord({
          id: 'session-checking',
          status: GameStatus.CHECKING,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            id: 'slot-checking',
            sortOrder: 2,
            status: GameStatus.CHECKING,
          },
        }),
        createSessionRecord({
          id: 'session-checking-later',
          status: GameStatus.CHECKING,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            id: 'slot-checking-later',
            sortOrder: 5,
            status: GameStatus.CHECKING,
          },
        }),
      ]);

      const result = await service.getCurrentOperations('user-1', UserRole.PLAYER);

      expect(result.checkingGame?.slotId).toBe('slot-checking');
      expect(result.checkingGame?.rawStatus).toBe(GameStatus.CHECKING);
    });

    it('prefers READY over NEXT for registrationOpenGame', async () => {
      const service = createOperationsService(
        [
          createSessionRecord({
            id: 'session-ready',
            status: GameStatus.READY,
            gameSlot: {
              ...createSessionRecord().gameSlot,
              id: 'slot-ready',
              sortOrder: 5,
              status: GameStatus.READY,
            },
          }),
        ],
        [createSlotRecord('slot-next', 1)],
      );

      const result = await service.getCurrentOperations('user-1', UserRole.PLAYER);

      expect(result.registrationOpenGame?.slotId).toBe('slot-ready');
      expect(result.queue.map((item) => item.slotId)).toEqual(['slot-next']);
    });

    it('queues remaining READY and NEXT items by slot sortOrder', async () => {
      const service = createOperationsService(
        [
          createSessionRecord({
            id: 'session-ready-open',
            status: GameStatus.READY,
            gameSlot: {
              ...createSessionRecord().gameSlot,
              id: 'slot-ready-open',
              sortOrder: 2,
              status: GameStatus.READY,
            },
          }),
          createSessionRecord({
            id: 'session-ready-queued',
            status: GameStatus.READY,
            gameSlot: {
              ...createSessionRecord().gameSlot,
              id: 'slot-ready-queued',
              sortOrder: 4,
              status: GameStatus.READY,
            },
          }),
        ],
        [
          createSlotRecord('slot-next-1', 1),
          createSlotRecord('slot-next-3', 3),
        ],
      );

      const result = await service.getCurrentOperations('user-1', UserRole.PLAYER);

      expect(result.registrationOpenGame?.slotId).toBe('slot-ready-open');
      expect(result.queue.map((item) => item.slotId)).toEqual([
        'slot-next-1',
        'slot-next-3',
        'slot-ready-queued',
      ]);
    });

    it('hides companyRevenue and userIds from player responses', async () => {
      const service = createOperationsService([
        createSessionRecord({
          gameCartelas: [
            createGameCartelaRecord({ userId: 'user-1', cartelaNumber: 12 }),
            createGameCartelaRecord({
              id: 'gc-2',
              userId: 'user-2',
              cartelaId: 'cartela-2',
              cartelaNumber: 24,
            }),
          ],
        }),
      ]);

      const playerResult = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );
      const adminResult = await service.getCurrentOperations(
        'admin-1',
        UserRole.ADMIN,
      );

      expect(playerResult.liveGame).not.toHaveProperty('companyRevenue');
      expect(adminResult.liveGame).toHaveProperty('companyRevenue', '2');
      expect(playerResult.liveGame?.registeredCartelasSummary).toEqual([
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 12,
          owner: 'ME',
          status: GameCartelaStatus.REGISTERED,
        },
        {
          cartelaId: 'cartela-2',
          cartelaNumber: 24,
          owner: 'OTHER',
          status: GameCartelaStatus.REGISTERED,
        },
      ]);
      expect(
        JSON.stringify(playerResult.liveGame?.registeredCartelasSummary),
      ).not.toContain('user-1');
      expect(
        JSON.stringify(playerResult.liveGame?.registeredCartelasSummary),
      ).not.toContain('user-2');
    });

    it('returns estimated winnerPayoutsSummary for admin during winner window', async () => {
      const service = createOperationsService([
        createSessionRecord({
          status: GameStatus.WINNER_WINDOW,
          prizeAmount: new Prisma.Decimal('10.00'),
          gameCartelas: [
            createGameCartelaRecord({
              id: 'gc-1',
              userId: 'user-1',
              cartelaId: 'cartela-1',
              cartelaNumber: 7,
            }),
            createGameCartelaRecord({
              id: 'gc-2',
              userId: 'user-2',
              cartelaId: 'cartela-2',
              cartelaNumber: 12,
            }),
            createGameCartelaRecord({
              id: 'gc-3',
              userId: 'user-3',
              cartelaId: 'cartela-3',
              cartelaNumber: 19,
            }),
          ].map((cartela) => ({
            ...cartela,
            status: GameCartelaStatus.WINNER,
            isWinner: true,
          })),
        }),
      ]);

      const adminResult = await service.getCurrentOperations(
        'admin-1',
        UserRole.ADMIN,
      );
      const playerResult = await service.getCurrentOperations(
        'user-2',
        UserRole.PLAYER,
      );

      expect(adminResult.liveGame?.winnerPayoutsSummary).toEqual([
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 7,
          amount: '3.34',
        },
        {
          cartelaId: 'cartela-2',
          cartelaNumber: 12,
          amount: '3.33',
        },
        {
          cartelaId: 'cartela-3',
          cartelaNumber: 19,
          amount: '3.33',
        },
      ]);
      expect(playerResult.liveGame?.winnerPayoutsSummary).toBeUndefined();
      expect(
        JSON.stringify(adminResult.liveGame?.winnerPayoutsSummary),
      ).not.toContain('user-');
    });
  });

  describe('updateSlotEntryFee', () => {
    function createEntryFeeService(options?: {
      registrationCount?: number;
      slotStatus?: GameStatus;
    }) {
      const tx = {
        gameSlot: {
          update: jest.fn().mockResolvedValue({
            id: 'slot-1',
            staticCode: 'SLOT-1',
            status: GameStatus.NEXT,
            entryFee: new Prisma.Decimal('12'),
            prizePerCartela: new Prisma.Decimal('8'),
            sortOrder: 1,
            gameRule: { id: 'rule-1', name: 'Full House', key: 'FULL_HOUSE' },
            sessions: [],
          }),
        },
        gameSession: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      const prisma = {
        $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
          callback(tx),
        ),
        gameSlot: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'slot-1',
            status: options?.slotStatus ?? GameStatus.NEXT,
            prizePerCartela: new Prisma.Decimal('8'),
          }),
        },
        gameCartela: {
          count: jest
            .fn()
            .mockResolvedValue(options?.registrationCount ?? 0),
        },
      };

      const realtimeService = {
        emitToSlot: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      };

      const service = new GamesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        {} as never,
        {} as never,
      );

      return { service, prisma, tx, realtimeService };
    }

    it('allows entry fee update when READY session has no registered cartelas', async () => {
      const { service, tx } = createEntryFeeService({ registrationCount: 0 });

      const result = await service.updateSlotEntryFee('slot-1', { entryFee: 12 });

      expect(result.entryFee).toBe('12');
      expect(tx.gameSlot.update).toHaveBeenCalled();
    });

    it('rejects entry fee update when READY session has registered cartelas', async () => {
      const { service, tx } = createEntryFeeService({ registrationCount: 2 });

      await expect(
        service.updateSlotEntryFee('slot-1', { entryFee: 12 }),
      ).rejects.toThrow('Entry fee cannot be changed after players have registered');

      expect(tx.gameSlot.update).not.toHaveBeenCalled();
    });
  });
});
