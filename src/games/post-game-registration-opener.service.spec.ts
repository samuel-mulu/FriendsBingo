import { GameOperationMode, GameStatus, Prisma } from '@prisma/client';
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';

describe('PostGameRegistrationOpenerService', () => {
  const gameTimingConfigServiceMock = {
    getRegistrationDurationSeconds: jest.fn().mockResolvedValue(120),
    getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(9),
    getFinishedResultDisplaySeconds: jest.fn().mockResolvedValue(60),
  };

  function createOpenedSessionRecord() {
    return {
      id: 'session-auto-2',
      gameSlotId: 'slot-auto-head',
      playCode: 'BINGO-NEXT1',
      entryFee: { toString: () => '10' },
      prizePerCartela: { toString: () => '8' },
      companyFeePerCartela: { toString: () => '2' },
      prizeAmount: { toString: () => '0' },
      companyRevenue: { toString: () => '0' },
      status: GameStatus.READY,
      autoCallEnabled: false,
      autoCallIntervalMs: 7000,
      nextAutoCallAt: null,
      scheduledStartAt: new Date('2026-06-10T12:01:00.000Z'),
      startedAt: new Date('2026-06-10T12:00:00.000Z'),
      finishedAt: null,
      cancelledReason: null,
      winnerCartelaId: null,
      winnerWindowStartedAt: null,
      winnerWindowEndsAt: null,
      prizeFinalizedAt: null,
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      gameSlot: {
        id: 'slot-auto-head',
        staticCode: 'FULL_HOUSE-S2',
        name: 'Full House',
        gameType: 'FULL_HOUSE',
        gameRuleId: 'rule-1',
        status: GameStatus.NEXT,
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
        category: 'NORMAL',
        fixedPrizeAmount: null,
        maxCartelasPerPlayer: null,
        sortOrder: 1,
        operationMode: GameOperationMode.AUTO,
        registrationDurationSeconds: 60,
        autoCallIntervalSeconds: 7,
        createdAt: new Date('2026-06-10T12:00:00.000Z'),
        updatedAt: new Date('2026-06-10T12:00:00.000Z'),
        gameRule: { id: 'rule-1', key: 'FULL_HOUSE', name: 'Full House' },
      },
      _count: { gameCartelas: 0, calledNumbers: 0 },
      gameCartelas: [],
      gameCartelaReservations: [],
    };
  }

  function createService(options?: {
    createdSession?: Record<string, unknown> | null;
    queueHead?: Record<string, unknown> | null;
    recentFinished?: { id: string } | null;
    activeSession?: { id: string } | null;
    dueBigGame?: { id: string } | null;
    existingReady?: { id: string; gameSlot?: { category?: string } } | null;
    ignoreReviewGrace?: boolean;
  }) {
    const gameSessionFindFirst = jest.fn();
    if (options?.ignoreReviewGrace) {
      gameSessionFindFirst
        .mockResolvedValueOnce(options?.activeSession ?? null)
        .mockResolvedValueOnce(options?.dueBigGame ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null);
    } else {
      gameSessionFindFirst
        .mockResolvedValueOnce(options?.activeSession ?? null)
        .mockResolvedValueOnce(options?.recentFinished ?? null)
        .mockResolvedValueOnce(options?.dueBigGame ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null);
    }

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      gameSession: {
        findFirst: gameSessionFindFirst,
        create: jest.fn().mockResolvedValue(options?.createdSession ?? null),
        update: jest.fn().mockResolvedValue(options?.createdSession ?? null),
      },
      gameSlot: {
        findMany: jest.fn().mockResolvedValue([
          options?.queueHead ?? {
            id: 'slot-auto-head',
            sortOrder: 1,
            category: 'NORMAL',
            fixedPrizeAmount: null,
            operationMode: GameOperationMode.AUTO,
            entryFee: new Prisma.Decimal('10'),
            prizePerCartela: new Prisma.Decimal('8'),
            registrationDurationSeconds: 60,
          },
        ]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'slot-auto-head', status: GameStatus.NEXT }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (
          callback: (client: typeof tx) => unknown,
          options?: { timeout?: number; maxWait?: number },
        ) => callback(tx),
      ),
    };

    const operationsCacheService = { invalidate: jest.fn() };
    const realtimeService = {
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };
    const gamePushNotificationsService = {
      notifyRegistrationOpened: jest.fn(),
    };
    const lifecycleLogger = {
      queueHeadSelected: jest.fn(),
      invalidSessionCreationBlocked: jest.fn(),
      sessionCreated: jest.fn(),
      registrationOpened: jest.fn(),
    };
    const invariantsService = {
      assertGameOperationInvariants: jest.fn(),
    };

    const service = new PostGameRegistrationOpenerService(
      prisma as never,
      gameTimingConfigServiceMock as never,
      operationsCacheService as never,
      realtimeService as never,
      gamePushNotificationsService as never,
      lifecycleLogger as never,
      invariantsService as never,
    );

    return {
      service,
      tx,
      prisma,
      operationsCacheService,
      realtimeService,
      gameTimingConfigService: gameTimingConfigServiceMock,
    };
  }

  it('opens READY registration for the next AUTO head slot when idle', async () => {
    const openedSession = createOpenedSessionRecord();
    const {
      service,
      tx,
      prisma,
      operationsCacheService,
      realtimeService,
      gameTimingConfigService,
    } = createService({ createdSession: openedSession });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(true);

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        timeout: expect.any(Number),
        maxWait: expect.any(Number),
      }),
    );
    expect(
      gameTimingConfigService.getRegistrationDurationSeconds,
    ).toHaveBeenCalled();
    expect(tx.gameSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-auto-head' },
        data: expect.objectContaining({
          registrationDurationSeconds: 120,
          autoCallIntervalSeconds: 9,
        }),
      }),
    );
    expect(tx.gameSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gameSlotId: 'slot-auto-head',
          status: GameStatus.READY,
          scheduledStartAt: expect.any(Date),
        }),
      }),
    );
    expect(operationsCacheService.invalidate).toHaveBeenCalled();
    expect(realtimeService.emitGameOperationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: 'slot-auto-head',
        sessionId: 'session-auto-2',
      }),
    );
  });

  it('opens deferred READY registration behind an active live game', async () => {
    const openedSession = {
      ...createOpenedSessionRecord(),
      scheduledStartAt: null,
    };
    const { service, tx } = createService({
      createdSession: openedSession,
      activeSession: { id: 'live-1' },
      ignoreReviewGrace: true,
    });

    await expect(
      service.openNextAutoQueueRegistration({
        ignoreReviewGrace: true,
        allowBehindActiveLive: true,
        countdownMode: 'deferred',
      }),
    ).resolves.toBe(true);

    expect(tx.gameSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameStatus.READY,
          scheduledStartAt: null,
        }),
      }),
    );
  });

  it('does not open registration when queue head is MANUAL', async () => {
    const { service, tx } = createService({
      queueHead: {
        id: 'slot-manual-head',
        sortOrder: 1,
        category: 'NORMAL',
        fixedPrizeAmount: null,
        operationMode: GameOperationMode.MANUAL,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        registrationDurationSeconds: null,
      },
    });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(false);

    expect(tx.gameSession.create).not.toHaveBeenCalled();
  });

  it('does not open registration while a FINISHED session is in review grace', async () => {
    const { service, tx } = createService({
      recentFinished: { id: 'finished-recent' },
    });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(false);

    expect(tx.gameSession.create).not.toHaveBeenCalled();
    expect(tx.gameSlot.findMany).not.toHaveBeenCalled();
  });

  it('opens registration during review grace when ignoreReviewGrace is true', async () => {
    const openedSession = createOpenedSessionRecord();
    const { service, tx } = createService({
      recentFinished: { id: 'finished-recent' },
      createdSession: openedSession,
      ignoreReviewGrace: true,
    });

    await expect(
      service.openNextAutoQueueRegistration({ ignoreReviewGrace: true }),
    ).resolves.toBe(true);

    expect(tx.gameSession.create).toHaveBeenCalled();
  });

  it('does not open another standard READY session while one already exists', async () => {
    const { service, tx } = createService({
      existingReady: {
        id: 'existing-ready',
        gameSlot: { category: 'NORMAL' },
      },
    });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(false);

    expect(tx.gameSession.create).not.toHaveBeenCalled();
  });

  it('does not open a deferred READY when one already exists behind live', async () => {
    const { service, tx } = createService({
      activeSession: { id: 'live-1' },
      existingReady: {
        id: 'existing-ready',
        gameSlot: { category: 'NORMAL' },
      },
      ignoreReviewGrace: true,
    });

    await expect(
      service.openNextAutoQueueRegistration({
        ignoreReviewGrace: true,
        allowBehindActiveLive: true,
        countdownMode: 'deferred',
      }),
    ).resolves.toBe(false);

    expect(tx.gameSession.create).not.toHaveBeenCalled();
  });

  it('prioritizes bonus AUTO queue slots before normal AUTO queue slots', async () => {
    const openedSession = createOpenedSessionRecord();
    const { service, tx } = createService({ createdSession: openedSession });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-normal-head',
        sortOrder: 1,
        category: 'NORMAL',
        fixedPrizeAmount: null,
        operationMode: GameOperationMode.AUTO,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        registrationDurationSeconds: 60,
      },
      {
        id: 'slot-bonus-head',
        sortOrder: 9,
        category: 'BONUS',
        fixedPrizeAmount: new Prisma.Decimal('5000'),
        operationMode: GameOperationMode.AUTO,
        entryFee: new Prisma.Decimal('0'),
        prizePerCartela: new Prisma.Decimal('0'),
        registrationDurationSeconds: 60,
      },
    ]);

    await service.openNextAutoQueueRegistration();

    expect(tx.gameSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-bonus-head' },
      }),
    );
  });

  it('prioritizes Big GOTD AUTO queue slots before normal AUTO queue slots', async () => {
    const openedSession = createOpenedSessionRecord();
    const { service, tx } = createService({ createdSession: openedSession });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-normal-head',
        sortOrder: 1,
        category: 'NORMAL',
        fixedPrizeAmount: null,
        operationMode: GameOperationMode.AUTO,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        registrationDurationSeconds: 60,
      },
      {
        id: 'slot-gotd-head',
        sortOrder: 9,
        category: 'BIG_GOTD',
        fixedPrizeAmount: new Prisma.Decimal('5000'),
        operationMode: GameOperationMode.AUTO,
        entryFee: new Prisma.Decimal('25'),
        prizePerCartela: new Prisma.Decimal('0'),
        registrationDurationSeconds: 60,
      },
    ]);

    await service.openNextAutoQueueRegistration();

    expect(tx.gameSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-gotd-head' },
      }),
    );
  });

  it('does not open the next normal or bonus registration while a due Big Game is waiting', async () => {
    const { service, tx } = createService({
      dueBigGame: { id: 'session-big-due' },
    });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(false);

    expect(tx.gameSlot.findMany).not.toHaveBeenCalled();
    expect(tx.gameSession.create).not.toHaveBeenCalled();
  });
});
