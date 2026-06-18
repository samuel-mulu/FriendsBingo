import { BadRequestException } from '@nestjs/common';
import {
  GameCartelaStatus,
  GameOperationMode,
  GameStatus,
  Prisma,
  UserRole,
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
        operationMode: GameOperationMode.MANUAL,
        registrationDurationSeconds: null,
        autoCallIntervalSeconds: null,
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
      gameCartelas: [],
      gameCartelaReservations: [],
      calledNumbers: [],
      scheduledStartAt: null,
      winnerWindowEndsAt: null,
      nextAutoCallAt: null,
      autoCallEnabled: false,
      autoCallIntervalMs: 7000,
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
      operationMode: GameOperationMode.MANUAL,
      registrationDurationSeconds: null,
      autoCallIntervalSeconds: null,
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
          gameSlot: { operationMode: GameOperationMode.MANUAL },
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
        findFirst: jest.fn().mockResolvedValue(null),
      },
      gameCartelaReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'reservation-1',
          gameSessionId: 'session-1',
          cartelaId: 'cartela-1',
          userId: 'user-1',
          expiresAt: new Date('2026-06-06T10:02:10.000Z'),
          status: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'reservation-1',
          gameSessionId: 'session-1',
          cartelaId: 'cartela-1',
          userId: 'user-1',
          expiresAt: new Date('2026-06-06T10:02:10.000Z'),
          status: 'ACTIVE',
        }),
        findUnique: jest.fn(),
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
      gameSession: {
        ...tx.gameSession,
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          gameSlotId: 'slot-1',
          prizeAmount: new Prisma.Decimal('8'),
          _count: { gameCartelas: 1 },
        }),
      },
      gameSlot: tx.gameSlot,
      gameCartela: tx.gameCartela,
      gameCartelaReservation: tx.gameCartelaReservation,
      cartela: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cartela-1',
          number: 1,
          b: [1, 2, 3, 4, 5],
          i: [16, 17, 18, 19, 20],
          n: [31, 32, 'FREE', 34, 35],
          g: [46, 47, 48, 49, 50],
          o: [61, 62, 63, 64, 65],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
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
      emitSessionCartelasUpdated: jest.fn(),
    };

    const userActionRateLimitService = {
      assertWithinLimit: jest.fn(),
    };

    const requestPerformance = new RequestPerformanceContext();
    const gameTimingConfigService = {
      getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
      getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(7),
      getCartelaHoldMs: jest.fn().mockResolvedValue(10_000),
      getPlayerConfig: jest.fn().mockResolvedValue({
        cartelaHoldSeconds: 10,
        finishedResultDisplaySeconds: 3,
        preparingDisplayMaxSeconds: null,
        missedNumberAnimationMs: 150,
        missedNumberStaggerMaxBalls: 10,
        flutterRefetchDebounceMs: 400,
      }),
    };

    return {
      service: new GamesService(
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
        requestPerformance,
        createOperationsCacheServiceMock() as never,
        gameTimingConfigService as never,
        {
          ensureAutoReadySessionHasCountdown: jest.fn(),
          repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
        } as never,
      ),
      prisma,
      tx,
      walletService,
      realtimeService,
      userActionRateLimitService,
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
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-1',
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
        registeredCartelasCount: 1,
        sessionId: 'session-1',
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

  it('returns existing registration without debiting wallet on duplicate retry', async () => {
    const { service, prisma, tx, walletService } = createService();
    const existingCartela = createGameCartelaRecord();

    prisma.gameCartela.findFirst = jest.fn().mockResolvedValue(existingCartela);

    const result = await service.registerCartela('session-1', 'user-1', {
      cartelaId: 'cartela-1',
    });

    expect(result.id).toBe(existingCartela.id);
    expect(walletService.debitWallet).not.toHaveBeenCalled();
    expect(tx.gameCartela.create).not.toHaveBeenCalled();
    expect(tx.gameSession.update).not.toHaveBeenCalled();
  });

  it('fails registration on insufficient balance and rolls back prize updates', async () => {
    const { service, tx, walletService } = createService();
    walletService.debitWallet.mockRejectedValue(
      new BadRequestException('Insufficient wallet balance'),
    );

    await expect(
      service.registerCartela('session-1', 'user-1', {
        cartelaId: 'cartela-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.gameCartela.create).toHaveBeenCalled();
    expect(walletService.debitWallet).toHaveBeenCalled();
    expect(tx.gameSession.update).not.toHaveBeenCalled();
  });

  it('blocks next-round registration when the cartela is already in the live round', async () => {
    const { service, tx, walletService } = createService();
    tx.gameSession.findUnique.mockResolvedValue({
      id: 'session-1',
      playCode: 'BINGO-NEXT123',
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      companyFeePerCartela: new Prisma.Decimal('2'),
      status: GameStatus.READY,
      scheduledStartAt: null,
      gameSlot: { operationMode: GameOperationMode.MANUAL },
    });
    tx.gameCartela.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'gc-live-lock' });

    await expect(
      service.registerCartela('session-1', 'user-1', {
        cartelaId: 'cartela-1',
      }),
    ).rejects.toThrow('already in use in the current live game');

    expect(walletService.debitWallet).not.toHaveBeenCalled();
    expect(tx.gameCartela.create).not.toHaveBeenCalled();
    expect(tx.gameSession.update).not.toHaveBeenCalled();
  });

  it('creates a cartela reservation without debiting wallet', async () => {
    const {
      service,
      tx,
      walletService,
      realtimeService,
      userActionRateLimitService,
    } = createService();

    const result = await service.reserveCartela(
      'session-1',
      'user-1',
      'cartela-1',
    );

    expect(userActionRateLimitService.assertWithinLimit).toHaveBeenCalledWith(
      'reserve',
      'user-1',
    );
    expect(tx.gameCartelaReservation.create).toHaveBeenCalled();
    expect(walletService.debitWallet).not.toHaveBeenCalled();
    expect(result.status).toBe('ACTIVE');
    expect(result.cartela).toEqual(
      expect.objectContaining({
        id: 'cartela-1',
        number: 1,
        b: [1, 2, 3, 4, 5],
      }),
    );
    expect(realtimeService.emitSessionCartelasUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', slotId: 'slot-1' }),
    );
  });

  it('confirms a reservation with wallet debit and registration', async () => {
    const { service, tx, walletService, realtimeService } = createService();
    tx.gameCartelaReservation.findUnique.mockResolvedValue({
      id: 'reservation-1',
      gameSessionId: 'session-1',
      cartelaId: 'cartela-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 5_000),
      status: 'ACTIVE',
      gameSession: {
        id: 'session-1',
        gameSlotId: 'slot-1',
        playCode: 'BINGO-ABC123',
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        companyFeePerCartela: new Prisma.Decimal('2'),
        status: GameStatus.PLAYING,
        gameSlot: { operationMode: GameOperationMode.MANUAL },
      },
    });
    tx.gameSession.update.mockResolvedValue({
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'BINGO-ABC123',
      prizeAmount: new Prisma.Decimal('8'),
      status: GameStatus.PLAYING,
      _count: { gameCartelas: 1, calledNumbers: 0 },
    });
    walletService.debitWallet.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '90.00',
      lockedBalance: '0.00',
      createdAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-06-06T10:02:00.000Z').toISOString(),
    });

    const result = await service.confirmReservation('reservation-1', 'user-1');

    expect(walletService.debitWallet).toHaveBeenCalled();
    expect(tx.gameCartela.create).toHaveBeenCalled();
    expect(tx.gameCartela.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.gameCartelaReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reservation-1' },
        data: { status: 'CONFIRMED' },
      }),
    );
    expect(result.status).toBe(GameCartelaStatus.REGISTERED);
    expect(realtimeService.emitSessionCartelasUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', slotId: 'slot-1' }),
    );
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

    prisma.gameSession.findFirst = jest.fn().mockImplementation(({ where }) => {
      const statuses: GameStatus[] = where.status?.in ?? [];
      if (
        statuses.includes(GameStatus.PLAYING) ||
        statuses.includes(GameStatus.WINNER_WINDOW)
      ) {
        return Promise.resolve(playingSession);
      }

      return Promise.resolve(null);
    });
    prisma.gameSession.findMany.mockResolvedValue([]);
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
      options?: {
        winnerCartelas?: Array<{
          cartelaId: string;
          cartela: { id: string; number: number };
        }>;
      },
    ) {
      const { service, prisma } = createService();
      const sortedSessions = [...activeSessions].sort(
        (left, right) =>
          (left.gameSlot.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.gameSlot.sortOrder ?? Number.MAX_SAFE_INTEGER),
      );

      prisma.gameSession.findFirst = jest
        .fn()
        .mockImplementation(({ where }) => {
          const statuses: GameStatus[] = where.status?.in ?? [];
          const excludedSlotIds: string[] = where.gameSlotId?.notIn ?? [];
          const match = sortedSessions.find(
            (session) =>
              statuses.includes(session.status) &&
              !excludedSlotIds.includes(session.gameSlot.id),
          );
          return Promise.resolve(match ?? null);
        });

      prisma.gameSession.findMany = jest
        .fn()
        .mockImplementation(({ where }) => {
          if (where.status === GameStatus.READY) {
            const excludedSlotIds: string[] = where.gameSlotId?.notIn ?? [];
            return Promise.resolve(
              sortedSessions.filter(
                (session) =>
                  session.status === GameStatus.READY &&
                  !excludedSlotIds.includes(session.gameSlot.id),
              ),
            );
          }

          if (where.gameSlotId && where.status === GameStatus.READY) {
            return Promise.resolve(
              sortedSessions.filter(
                (session) =>
                  session.gameSlot.id === where.gameSlotId &&
                  session.status === GameStatus.READY,
              ),
            );
          }

          return Promise.resolve([]);
        });

      prisma.gameCartela.findMany.mockResolvedValue(
        options?.winnerCartelas ?? [],
      );
      prisma.gameSlot.findMany.mockResolvedValue(nextSlots);
      return { service, prisma };
    }

    it('selects PLAYING by slot sortOrder even when READY/NEXT have lower sortOrder', async () => {
      const { service } = createOperationsService(
        [
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
        ],
        [createSlotRecord('slot-next', 2)],
      );

      const result = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );

      expect(result.liveGame?.slotId).toBe('slot-playing');
      expect(result.registrationOpenGame?.slotId).toBe('slot-ready');
      expect(result.queue.map((item) => item.slotId)).toEqual(['slot-next']);
    });

    it('places CHECKING in checkingGame by slot sortOrder', async () => {
      const { service } = createOperationsService([
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

      const result = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );

      expect(result.checkingGame?.slotId).toBe('slot-checking');
      expect(result.checkingGame?.rawStatus).toBe(GameStatus.CHECKING);
    });

    it('prefers READY over NEXT for registrationOpenGame', async () => {
      const { service } = createOperationsService(
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

      const result = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );

      expect(result.registrationOpenGame?.slotId).toBe('slot-ready');
      expect(result.queue.map((item) => item.slotId)).toEqual(['slot-next']);
    });

    it('queues remaining READY and NEXT items by slot sortOrder', async () => {
      const { service } = createOperationsService(
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

      const result = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );

      expect(result.registrationOpenGame?.slotId).toBe('slot-ready-open');
      expect(result.queue.map((item) => item.slotId)).toEqual([
        'slot-next-1',
        'slot-next-3',
        'slot-ready-queued',
      ]);
    });

    it('hides companyRevenue from player operations snapshots', async () => {
      const { service } = createOperationsService([createSessionRecord()]);

      const playerResult = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );
      const adminResult = await service.getCurrentOperations(
        'admin-1',
        UserRole.ADMIN,
      );

      expect(playerResult.liveGame).not.toHaveProperty('companyRevenue');
      expect(playerResult.liveGame).not.toHaveProperty(
        'registeredCartelasSummary',
      );
      expect(adminResult.liveGame).toHaveProperty('companyRevenue', '2');
    });

    it('does not include registeredCartelasSummary in operations/current', async () => {
      const { service } = createOperationsService([createSessionRecord()]);

      const result = await service.getCurrentOperations(
        'user-1',
        UserRole.PLAYER,
      );

      expect(result.liveGame).not.toHaveProperty('registeredCartelasSummary');
      if (result.registrationOpenGame != null) {
        expect(result.registrationOpenGame).not.toHaveProperty(
          'registeredCartelasSummary',
        );
      }
    });

    it('returns estimated winnerPayoutsSummary for admin during winner window', async () => {
      const winnerCartelas = [
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
      }));

      const { service } = createOperationsService(
        [
          createSessionRecord({
            status: GameStatus.WINNER_WINDOW,
            prizeAmount: new Prisma.Decimal('10.00'),
          }),
        ],
        [],
        {
          winnerCartelas,
        },
      );

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
          owner: 'OTHER',
        },
        {
          cartelaId: 'cartela-2',
          cartelaNumber: 12,
          amount: '3.33',
          owner: 'OTHER',
        },
        {
          cartelaId: 'cartela-3',
          cartelaNumber: 19,
          amount: '3.33',
          owner: 'OTHER',
        },
      ]);
      expect(playerResult.liveGame?.winnerPayoutsSummary).toBeUndefined();
      expect(
        JSON.stringify(adminResult.liveGame?.winnerPayoutsSummary),
      ).not.toContain('user-');
    });
  });

  describe('getRegistrationState', () => {
    it('returns cartela availability without exposing user ids', async () => {
      const { service, prisma } = createService();
      prisma.gameSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: GameStatus.PLAYING,
      });
      prisma.gameCartela.findMany.mockResolvedValue([
        {
          id: 'gc-1',
          cartelaId: 'cartela-1',
          userId: 'user-1',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: { id: 'cartela-1', number: 12 },
        },
        {
          id: 'gc-2',
          cartelaId: 'cartela-2',
          userId: 'user-2',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: { id: 'cartela-2', number: 24 },
        },
      ]);
      prisma.gameCartelaReservation.findMany.mockResolvedValue([
        {
          cartelaId: 'cartela-3',
          userId: 'user-3',
          expiresAt: new Date(Date.now() + 8_000),
          cartela: { id: 'cartela-3', number: 36 },
        },
      ]);

      const result = await service.getRegistrationState('session-1', 'user-1');

      expect(result.myCartelaIds).toEqual(['cartela-1']);
      expect(result.registeredCartelasSummary).toEqual([
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
        {
          cartelaId: 'cartela-3',
          cartelaNumber: 36,
          owner: 'RESERVED_OTHER',
          status: 'RESERVED',
          expiresAt: expect.any(String),
        },
      ]);
      expect(result.reservedCartelasSummary).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('user-1');
      expect(JSON.stringify(result)).not.toContain('user-2');
    });

    it('includes current live-round cartelas as unavailable for next-round registration', async () => {
      const { service, prisma } = createService();
      prisma.gameSession.findUnique.mockResolvedValue({
        id: 'session-ready-1',
        status: GameStatus.READY,
      });
      prisma.gameCartela.findMany = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'gc-live-1',
            cartelaId: 'cartela-live-1',
            userId: 'user-live-1',
            status: GameCartelaStatus.REGISTERED,
            isWinner: false,
            cartela: { id: 'cartela-live-1', number: 77 },
          },
        ]);
      prisma.gameCartelaReservation.findMany = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getRegistrationState(
        'session-ready-1',
        'user-1',
      );

      expect(result.registeredCartelasSummary).toEqual([
        {
          cartelaId: 'cartela-live-1',
          cartelaNumber: 77,
          owner: 'OTHER',
          status: GameCartelaStatus.REGISTERED,
        },
      ]);
      expect(result.myCartelaIds).toEqual([]);
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
          count: jest.fn().mockResolvedValue(options?.registrationCount ?? 0),
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
        {} as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        {} as never,
        { cancelSession: jest.fn() } as never,
        {} as never,
        { assertWithinLimit: jest.fn() } as never,
        new RequestPerformanceContext(),
        createOperationsCacheServiceMock() as never,
        {
          getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
          getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(7),
          getCartelaHoldMs: jest.fn().mockResolvedValue(10_000),
          getPlayerConfig: jest.fn(),
        } as never,
        {
          ensureAutoReadySessionHasCountdown: jest.fn(),
          repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
        } as never,
      );

      return { service, prisma, tx, realtimeService };
    }

    it('allows entry fee update when READY session has no registered cartelas', async () => {
      const { service, tx } = createEntryFeeService({ registrationCount: 0 });

      const result = await service.updateSlotEntryFee('slot-1', {
        entryFee: 12,
      });

      expect(result.entryFee).toBe('12');
      expect(tx.gameSlot.update).toHaveBeenCalled();
    });

    it('rejects entry fee update when READY session has registered cartelas', async () => {
      const { service, tx } = createEntryFeeService({ registrationCount: 2 });

      await expect(
        service.updateSlotEntryFee('slot-1', { entryFee: 12 }),
      ).rejects.toThrow(
        'Entry fee cannot be changed after players have registered',
      );

      expect(tx.gameSlot.update).not.toHaveBeenCalled();
    });
  });

  describe('AUTO operation mode', () => {
    function createAutoService() {
      const tx = {
        gameSlot: {
          create: jest.fn().mockResolvedValue({
            id: 'slot-auto-1',
            staticCode: 'FULL_HOUSE-S1',
            name: 'Full House',
            gameType: 'FULL_HOUSE',
            gameRuleId: 'rule-1',
            status: GameStatus.NEXT,
            entryFee: new Prisma.Decimal('10'),
            prizePerCartela: new Prisma.Decimal('8'),
            sortOrder: 1,
            operationMode: GameOperationMode.AUTO,
            registrationDurationSeconds: 60,
            autoCallIntervalSeconds: 7,
            gameRule: {
              id: 'rule-1',
              key: 'FULL_HOUSE',
              name: 'Full House',
            },
            sessions: [],
          }),
        },
        gameSession: {
          create: jest.fn().mockResolvedValue({
            id: 'session-auto-1',
            gameSlotId: 'slot-auto-1',
            playCode: 'BINGO-AUTO1',
            status: GameStatus.READY,
            scheduledStartAt: new Date('2026-06-10T12:01:00.000Z'),
            entryFee: new Prisma.Decimal('10'),
            prizePerCartela: new Prisma.Decimal('8'),
            companyFeePerCartela: new Prisma.Decimal('2'),
            prizeAmount: new Prisma.Decimal('0'),
            companyRevenue: new Prisma.Decimal('0'),
            gameSlot: {
              id: 'slot-auto-1',
              staticCode: 'FULL_HOUSE-S1',
              operationMode: GameOperationMode.AUTO,
            },
            _count: { gameCartelas: 0, calledNumbers: 0 },
            gameCartelas: [],
            gameCartelaReservations: [],
          }),
        },
      };

      const prisma = {
        $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
          callback(tx),
        ),
        gameSlot: {
          count: jest.fn().mockResolvedValue(0),
        },
        gameSession: {
          findUnique: jest.fn(),
        },
      };

      const gameRulesService = {
        getActiveGameRuleOrThrow: jest.fn().mockResolvedValue({
          id: 'rule-1',
          key: 'FULL_HOUSE',
          name: 'Full House',
        }),
      };

      const gameQueueService = {
        assignSortOrderOnCreate: jest.fn().mockResolvedValue(1),
      };

      const realtimeService = {
        emitToAdmin: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitToSession: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      };

      const service = new GamesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        gameRulesService as never,
        {} as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        gameQueueService as never,
        { cancelSession: jest.fn() } as never,
        {} as never,
        { assertWithinLimit: jest.fn() } as never,
        new RequestPerformanceContext(),
        createOperationsCacheServiceMock() as never,
        {
          getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
          getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(7),
          getCartelaHoldMs: jest.fn().mockResolvedValue(10_000),
          getPlayerConfig: jest.fn(),
        } as never,
        {
          ensureAutoReadySessionHasCountdown: jest.fn(),
          repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
        } as never,
      );

      return { service, tx, realtimeService };
    }

    it('creates MANUAL slot without creating a session', async () => {
      const { service, tx } = createAutoService();

      await service.createGameSlot({
        gameRuleId: 'rule-1',
        operationMode: GameOperationMode.MANUAL,
      });

      expect(tx.gameSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationMode: GameOperationMode.MANUAL,
            registrationDurationSeconds: null,
            autoCallIntervalSeconds: null,
          }),
        }),
      );
      expect(tx.gameSession.create).not.toHaveBeenCalled();
    });

    it('creates AUTO slot with READY session and scheduledStartAt', async () => {
      const { service, tx } = createAutoService();

      await service.createGameSlot({
        gameRuleId: 'rule-1',
        operationMode: GameOperationMode.AUTO,
      });

      expect(tx.gameSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationMode: GameOperationMode.AUTO,
            registrationDurationSeconds: 60,
            autoCallIntervalSeconds: 7,
          }),
        }),
      );
      expect(tx.gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: GameStatus.READY,
            scheduledStartAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects PLAYING registration for AUTO slots', async () => {
      const { service, tx } = createService();
      tx.gameSession.findUnique.mockResolvedValueOnce({
        id: 'session-1',
        playCode: 'BINGO-ABC123',
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        companyFeePerCartela: new Prisma.Decimal('2'),
        status: GameStatus.PLAYING,
        gameSlot: { operationMode: GameOperationMode.AUTO },
      });

      await expect(
        service.registerCartela('session-1', 'user-1', {
          cartelaId: 'cartela-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('switchSlotOperationMode', () => {
    function createSwitchService(options?: {
      slot?: Record<string, unknown>;
      latestSession?: Record<string, unknown> | null;
      activeSessionAfterTx?: Record<string, unknown> | null;
      updatedSlot?: Record<string, unknown>;
    }) {
      const slot = {
        id: 'slot-1',
        status: GameStatus.NEXT,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        operationMode: GameOperationMode.MANUAL,
        ...options?.slot,
      };

      const tx = {
        gameSlot: {
          update: jest.fn().mockResolvedValue(slot),
        },
        gameSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'session-ready-1' }),
          update: jest.fn().mockResolvedValue({ id: 'session-ready-1' }),
        },
      };

      const prisma = {
        $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
          callback(tx),
        ),
        gameSlot: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(slot)
            .mockResolvedValue(
              options?.updatedSlot ?? {
                ...createSlotRecord('slot-1', 1),
                operationMode: GameOperationMode.MANUAL,
                sessions: [],
              },
            ),
        },
        gameSession: {
          findFirst: jest
            .fn()
            .mockResolvedValue(options?.latestSession ?? null),
          findUnique: jest.fn().mockResolvedValue(
            options?.activeSessionAfterTx ??
              createSessionRecord({
                id: 'session-ready-1',
                status: GameStatus.READY,
                scheduledStartAt: new Date('2026-06-10T12:01:00.000Z'),
                gameSlot: {
                  ...createSessionRecord().gameSlot,
                  operationMode: GameOperationMode.AUTO,
                },
              }),
          ),
        },
      };

      const realtimeService = {
        emitGameOperationUpdate: jest.fn(),
      };

      const autoCallService = {
        startAutoCall: jest.fn().mockResolvedValue({ success: true }),
        stopAutoCall: jest.fn().mockResolvedValue({ success: true }),
      };
      const autoReadyCountdownRepairService = {
        ensureAutoReadySessionHasCountdown: jest.fn(),
        repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
      };

      const service = new GamesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        {} as never,
        { cancelSession: jest.fn() } as never,
        autoCallService as never,
        { assertWithinLimit: jest.fn() } as never,
        new RequestPerformanceContext(),
        createOperationsCacheServiceMock() as never,
        {
          getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
          getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(7),
          getCartelaHoldMs: jest.fn().mockResolvedValue(10_000),
          getPlayerConfig: jest.fn(),
        } as never,
        autoReadyCountdownRepairService as never,
      );

      return {
        service,
        tx,
        prisma,
        realtimeService,
        autoCallService,
        autoReadyCountdownRepairService,
        slot,
      };
    }

    it('NEXT without session switching to AUTO creates READY with scheduledStartAt', async () => {
      const { service, tx, autoReadyCountdownRepairService } =
        createSwitchService();

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
      });

      expect(tx.gameSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationMode: GameOperationMode.AUTO,
            registrationDurationSeconds: 60,
            autoCallIntervalSeconds: 7,
          }),
        }),
      );
      expect(tx.gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: GameStatus.READY,
            scheduledStartAt: expect.any(Date),
          }),
        }),
      );
      expect(
        autoReadyCountdownRepairService.ensureAutoReadySessionHasCountdown,
      ).toHaveBeenCalledWith('session-ready-1');
    });

    it('READY with cartelas switching to AUTO keeps session and sets scheduledStartAt', async () => {
      const { service, tx, autoReadyCountdownRepairService } =
        createSwitchService({
          latestSession: {
            id: 'session-ready-1',
            status: GameStatus.READY,
            autoCallEnabled: false,
          },
        });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
        registrationDurationSeconds: 60,
      });

      expect(tx.gameSession.create).not.toHaveBeenCalled();
      expect(tx.gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-ready-1' },
          data: { scheduledStartAt: expect.any(Date) },
        }),
      );
      expect(
        autoReadyCountdownRepairService.ensureAutoReadySessionHasCountdown,
      ).toHaveBeenCalledWith('session-ready-1');
    });

    it('PLAYING switching to AUTO starts auto-call without resetting game', async () => {
      const { service, tx, autoCallService } = createSwitchService({
        slot: {
          status: GameStatus.PLAYING,
          operationMode: GameOperationMode.MANUAL,
        },
        latestSession: {
          id: 'session-live-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: false,
        },
        activeSessionAfterTx: createSessionRecord({
          id: 'session-live-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
          autoCallIntervalMs: 7000,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            status: GameStatus.PLAYING,
            operationMode: GameOperationMode.AUTO,
          },
        }),
      });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
        autoCallIntervalSeconds: 7,
      });

      expect(tx.gameSession.create).not.toHaveBeenCalled();
      expect(tx.gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-live-1' },
          data: { autoCallIntervalMs: 7000 },
        }),
      );
      expect(autoCallService.startAutoCall).toHaveBeenCalledWith(
        'session-live-1',
      );
    });

    it('AUTO READY switching to MANUAL clears scheduledStartAt', async () => {
      const { service, tx } = createSwitchService({
        slot: {
          operationMode: GameOperationMode.AUTO,
          registrationDurationSeconds: 60,
          autoCallIntervalSeconds: 7,
        },
        latestSession: {
          id: 'session-ready-1',
          status: GameStatus.READY,
          autoCallEnabled: false,
        },
        activeSessionAfterTx: createSessionRecord({
          id: 'session-ready-1',
          status: GameStatus.READY,
          scheduledStartAt: null,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            operationMode: GameOperationMode.MANUAL,
            registrationDurationSeconds: null,
            autoCallIntervalSeconds: null,
          },
        }),
      });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.MANUAL,
      });

      expect(tx.gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { scheduledStartAt: null },
        }),
      );
      expect(tx.gameSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationMode: GameOperationMode.MANUAL,
            registrationDurationSeconds: null,
            autoCallIntervalSeconds: null,
          }),
        }),
      );
    });

    it('allows switching NEXT queue slots after a FINISHED session', async () => {
      const { service, tx } = createSwitchService({
        slot: {
          status: GameStatus.NEXT,
          operationMode: GameOperationMode.MANUAL,
        },
        latestSession: {
          id: 'session-done-1',
          status: GameStatus.FINISHED,
          autoCallEnabled: false,
        },
      });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
      });

      expect(tx.gameSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationMode: GameOperationMode.AUTO,
          }),
        }),
      );
      expect(tx.gameSession.create).toHaveBeenCalled();
    });

    it('rejects switching for WINNER_WINDOW sessions', async () => {
      const { service } = createSwitchService({
        latestSession: {
          id: 'session-winner-1',
          status: GameStatus.WINNER_WINDOW,
          autoCallEnabled: false,
        },
      });

      await expect(
        service.switchSlotOperationMode('slot-1', {
          operationMode: GameOperationMode.AUTO,
        }),
      ).rejects.toThrow('This game can no longer be switched to automatic.');
    });

    it('repeated PATCH to AUTO does not duplicate READY session', async () => {
      const { service, tx } = createSwitchService({
        latestSession: {
          id: 'session-ready-1',
          status: GameStatus.READY,
          autoCallEnabled: false,
        },
      });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
      });
      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.AUTO,
      });

      expect(tx.gameSession.create).not.toHaveBeenCalled();
      expect(tx.gameSession.update).toHaveBeenCalledTimes(2);
    });

    it('PLAYING switching to MANUAL stops auto-call', async () => {
      const { service, autoCallService } = createSwitchService({
        slot: {
          status: GameStatus.PLAYING,
          operationMode: GameOperationMode.AUTO,
          registrationDurationSeconds: 60,
          autoCallIntervalSeconds: 7,
        },
        latestSession: {
          id: 'session-live-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
        },
        activeSessionAfterTx: createSessionRecord({
          id: 'session-live-1',
          status: GameStatus.PLAYING,
          autoCallEnabled: false,
          gameSlot: {
            ...createSessionRecord().gameSlot,
            status: GameStatus.PLAYING,
            operationMode: GameOperationMode.MANUAL,
          },
        }),
      });

      await service.switchSlotOperationMode('slot-1', {
        operationMode: GameOperationMode.MANUAL,
      });

      expect(autoCallService.stopAutoCall).toHaveBeenCalledWith(
        'session-live-1',
      );
    });
  });
});
