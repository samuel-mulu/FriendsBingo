import { GameOperationMode, GameStatus } from '@prisma/client';
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
    existingReady?: { id: string } | null;
    ignoreReviewGrace?: boolean;
  }) {
    const gameSessionFindFirst = jest.fn();
    if (options?.ignoreReviewGrace) {
      gameSessionFindFirst
        .mockResolvedValueOnce(options?.activeSession ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null);
    } else {
      gameSessionFindFirst
        .mockResolvedValueOnce(options?.activeSession ?? null)
        .mockResolvedValueOnce(options?.recentFinished ?? null)
        .mockResolvedValueOnce(options?.existingReady ?? null);
    }

    const tx = {
      gameSession: {
        findFirst: gameSessionFindFirst,
        create: jest.fn().mockResolvedValue(options?.createdSession ?? null),
      },
      gameSlot: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.queueHead ?? {
              id: 'slot-auto-head',
              operationMode: GameOperationMode.AUTO,
              entryFee: { toString: () => '10' },
              prizePerCartela: { toString: () => '8' },
              registrationDurationSeconds: 60,
            },
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx),
      ),
    };

    const operationsCacheService = { invalidate: jest.fn() };
    const autoReadyCountdownRepairService = {
      ensureAutoReadySessionHasCountdown: jest.fn().mockResolvedValue({
        repaired: false,
      }),
    };
    const realtimeService = {
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const service = new PostGameRegistrationOpenerService(
      prisma as never,
      gameTimingConfigServiceMock as never,
      operationsCacheService as never,
      autoReadyCountdownRepairService as never,
      realtimeService as never,
    );

    return {
      service,
      tx,
      prisma,
      operationsCacheService,
      autoReadyCountdownRepairService,
      realtimeService,
      gameTimingConfigService: gameTimingConfigServiceMock,
    };
  }

  it('opens READY registration for the next AUTO head slot when idle', async () => {
    const openedSession = createOpenedSessionRecord();
    const {
      service,
      tx,
      operationsCacheService,
      autoReadyCountdownRepairService,
      realtimeService,
      gameTimingConfigService,
    } = createService({ createdSession: openedSession });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(true);

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
    expect(
      autoReadyCountdownRepairService.ensureAutoReadySessionHasCountdown,
    ).toHaveBeenCalledWith(openedSession.id);
    expect(operationsCacheService.invalidate).toHaveBeenCalled();
    expect(realtimeService.emitGameOperationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: 'slot-auto-head',
        sessionId: 'session-auto-2',
      }),
    );
  });

  it('does not open registration when queue head is MANUAL', async () => {
    const { service, tx } = createService({
      queueHead: {
        id: 'slot-manual-head',
        operationMode: GameOperationMode.MANUAL,
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
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
    expect(tx.gameSlot.findFirst).not.toHaveBeenCalled();
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

  it('does not duplicate an existing READY session for the AUTO head slot', async () => {
    const { service, tx } = createService({
      existingReady: { id: 'existing-ready' },
    });

    await expect(service.openNextAutoQueueRegistration()).resolves.toBe(false);

    expect(tx.gameSession.create).not.toHaveBeenCalled();
  });
});
