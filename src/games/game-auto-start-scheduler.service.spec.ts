import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameAutoStartSchedulerService } from './game-auto-start-scheduler.service';

describe('GameAutoStartSchedulerService', () => {
  const gameTimingConfigServiceMock = {
    getRegistrationDurationSeconds: jest.fn().mockResolvedValue(120),
    getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(9),
    getFinishedResultDisplaySeconds: jest.fn().mockResolvedValue(60),
  };

  function createService(options?: {
    dueSessions?: Array<Record<string, unknown>>;
    claimCount?: number;
    dueSessionDetail?: Record<string, unknown> | null;
    activeLiveSession?: { id: string } | null;
    cancelSessionResult?: { aborted: boolean };
    openNextRegistrationResult?: boolean;
  }) {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue(options?.dueSessions ?? []),
        findFirst: jest.fn().mockResolvedValue(options?.activeLiveSession ?? null),
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
        category: 'NORMAL',
        operationMode: GameOperationMode.AUTO,
        autoCallIntervalSeconds: 7,
      },
      ...overrides,
    };
  }

  it('starts game and auto-call after claiming a due READY session', async () => {
    const { service, prisma, gameEngineService, autoCallService } =
      createService({
        dueSessions: [
          {
            id: 'session-1',
            gameSlotId: 'slot-1',
            scheduledStartAt: new Date(Date.now() - 1_000),
            gameSlot: { category: 'NORMAL', sortOrder: 1 },
          },
        ],
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
      dueSessions: [
        {
          id: 'session-1',
          gameSlotId: 'slot-1',
          scheduledStartAt: new Date(Date.now() - 1_000),
          gameSlot: { category: 'NORMAL', sortOrder: 1 },
        },
      ],
      claimCount: 0,
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameEngineService.startGame).not.toHaveBeenCalled();
  });

  it('cancels empty READY sessions through the lifecycle service', async () => {
    const { service, gameEngineService, gameLifecycleService } = createService({
      dueSessions: [
        {
          id: 'session-1',
          gameSlotId: 'slot-1',
          scheduledStartAt: new Date(Date.now() - 1_000),
          gameSlot: { category: 'NORMAL', sortOrder: 1 },
        },
      ],
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
      dueSessions: [
        {
          id: 'session-1',
          gameSlotId: 'slot-1',
          scheduledStartAt: new Date(Date.now() - 1_000),
          gameSlot: { category: 'NORMAL', sortOrder: 1 },
        },
      ],
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

  it('restores a due scheduledStartAt when auto-start fails so registration does not reopen', async () => {
    const { service, prisma, gameEngineService } = createService({
      dueSessions: [
        {
          id: 'session-1',
          gameSlotId: 'slot-1',
          scheduledStartAt: new Date(Date.now() - 1_000),
          gameSlot: { category: 'NORMAL', sortOrder: 1 },
        },
      ],
      claimCount: 1,
      dueSessionDetail: createDueSessionDetail(),
    });
    gameEngineService.startGame.mockRejectedValue(
      new Error('Only the first slot in the queue can be started'),
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.gameSession.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'session-1',
          status: GameStatus.READY,
          scheduledStartAt: null,
        },
        data: { scheduledStartAt: expect.any(Date) },
      }),
    );
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

  it('starts a due Big Game even when it is not AUTO, without starting auto-call', async () => {
    const { service, prisma, gameEngineService, autoCallService } =
      createService({
        dueSessions: [
          {
            id: 'session-big-1',
            gameSlotId: 'slot-big-1',
            scheduledStartAt: new Date(Date.now() - 1_000),
            gameSlot: { category: 'BIG_GAME', sortOrder: 9 },
          },
        ],
        claimCount: 1,
        dueSessionDetail: createDueSessionDetail({
          id: 'session-big-1',
          gameSlotId: 'slot-big-1',
          gameSlot: {
            id: 'slot-big-1',
            category: 'BIG_GAME',
            operationMode: GameOperationMode.MANUAL,
            autoCallIntervalSeconds: null,
          },
        }),
      });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameEngineService.startGame).toHaveBeenCalledWith('slot-big-1');
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
    expect(autoCallService.startAutoCall).not.toHaveBeenCalled();
  });

  it('leaves a due Big Game waiting when another game is already live', async () => {
    const { service, prisma, gameEngineService } = createService({
      dueSessions: [
        {
          id: 'session-big-1',
          gameSlotId: 'slot-big-1',
          scheduledStartAt: new Date(Date.now() - 1_000),
          gameSlot: { category: 'BIG_GAME', sortOrder: 9 },
        },
      ],
      activeLiveSession: { id: 'live-1' },
      claimCount: 1,
      dueSessionDetail: createDueSessionDetail({
        id: 'session-big-1',
        gameSlotId: 'slot-big-1',
        gameSlot: {
          id: 'slot-big-1',
          category: 'BIG_GAME',
          operationMode: GameOperationMode.MANUAL,
          autoCallIntervalSeconds: null,
        },
      }),
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).not.toHaveBeenCalled();
    expect(gameEngineService.startGame).not.toHaveBeenCalled();
  });
});
