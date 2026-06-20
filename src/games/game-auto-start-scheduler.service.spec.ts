import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameAutoStartSchedulerService } from './game-auto-start-scheduler.service';

describe('GameAutoStartSchedulerService', () => {
  const gameTimingConfigServiceMock = {
    getRegistrationDurationSeconds: jest.fn().mockResolvedValue(120),
    getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(9),
    getFinishedResultDisplaySeconds: jest.fn().mockResolvedValue(60),
  };

  function createService(options?: {
    dueSessions?: Array<{ id: string; gameSlotId: string }>;
    claimCount?: number;
    dueSessionDetail?: Record<string, unknown> | null;
    cancelSessionResult?: { aborted: boolean };
    openNextRegistrationResult?: boolean;
  }) {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue(options?.dueSessions ?? []),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: options?.claimCount ?? 0 }),
        findUnique: jest
          .fn()
          .mockResolvedValue(options?.dueSessionDetail ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const gameEngineService = {
      startGame: jest.fn().mockResolvedValue({ id: 'session-1' }),
    };

    const autoCallService = {
      startAutoCall: jest.fn().mockResolvedValue({ success: true }),
    };

    const gameLifecycleService = {
      cancelSession: jest.fn().mockResolvedValue(
        options?.cancelSessionResult ?? {
          aborted: false,
          sessionId: 'session-1',
          slotId: 'slot-1',
          reason: 'no_players',
          refundedCount: 0,
        },
      ),
    };

    const autoReadyCountdownRepairService = {
      repairAllMissingAutoReadyCountdowns: jest.fn().mockResolvedValue(0),
    };

    const postGameRegistrationOpenerService = {
      openNextAutoQueueRegistration: jest
        .fn()
        .mockResolvedValue(options?.openNextRegistrationResult ?? false),
    };

    const service = new GameAutoStartSchedulerService(
      prisma as never,
      gameEngineService as never,
      autoCallService as never,
      gameLifecycleService as never,
      gameTimingConfigServiceMock as never,
      autoReadyCountdownRepairService as never,
      postGameRegistrationOpenerService as never,
    );

    return {
      service,
      prisma,
      gameEngineService,
      autoCallService,
      gameLifecycleService,
      autoReadyCountdownRepairService,
      postGameRegistrationOpenerService,
    };
  }

  function createDueSessionDetail(overrides?: Record<string, unknown>) {
    return {
      id: 'session-1',
      gameSlotId: 'slot-1',
      _count: { gameCartelas: 2 },
      gameSlot: {
        id: 'slot-1',
        operationMode: GameOperationMode.AUTO,
        autoCallIntervalSeconds: 7,
      },
      ...overrides,
    };
  }

  it('starts game and auto-call after claiming a due READY session', async () => {
    const { service, prisma, gameEngineService, autoCallService } =
      createService({
        dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
        claimCount: 1,
        dueSessionDetail: createDueSessionDetail(),
      });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          status: GameStatus.READY,
          scheduledStartAt: { lte: expect.any(Date) },
        },
        data: { scheduledStartAt: null },
      }),
    );
    expect(gameEngineService.startGame).toHaveBeenCalledWith('slot-1');
    expect(prisma.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { autoCallIntervalMs: 9000 },
    });
    expect(autoCallService.startAutoCall).toHaveBeenCalledWith('session-1', {
      callFirstImmediately: true,
    });
  });

  it('repairs missing AUTO READY countdowns before processing due sessions', async () => {
    const { service, autoReadyCountdownRepairService } = createService();

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(
      autoReadyCountdownRepairService.repairAllMissingAutoReadyCountdowns,
    ).toHaveBeenCalledTimes(1);
  });

  it('skips when the READY claim update does not win', async () => {
    const { service, gameEngineService } = createService({
      dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
      claimCount: 0,
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameEngineService.startGame).not.toHaveBeenCalled();
  });

  it('cancels empty READY sessions through the lifecycle service', async () => {
    const { service, gameEngineService, gameLifecycleService } = createService({
      dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
      claimCount: 1,
      dueSessionDetail: createDueSessionDetail({
        _count: { gameCartelas: 0 },
      }),
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameLifecycleService.cancelSession).toHaveBeenCalledWith(
      'session-1',
      'no_players',
      { abortIfPlayersRegistered: true },
    );
    expect(gameEngineService.startGame).not.toHaveBeenCalled();
  });

  it('starts the game when the empty cancel aborts because players registered', async () => {
    const { service, gameEngineService, gameLifecycleService } = createService({
      dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
      claimCount: 1,
      dueSessionDetail: createDueSessionDetail({
        _count: { gameCartelas: 0 },
      }),
      cancelSessionResult: { aborted: true },
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameLifecycleService.cancelSession).toHaveBeenCalled();
    expect(gameEngineService.startGame).toHaveBeenCalledWith('slot-1');
  });

  it('delegates queue progression to the registration opener on tick', async () => {
    const { service, postGameRegistrationOpenerService } = createService({
      openNextRegistrationResult: true,
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(
      postGameRegistrationOpenerService.openNextAutoQueueRegistration,
    ).toHaveBeenCalledWith();
  });
});
