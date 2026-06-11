import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameAutoStartSchedulerService } from './game-auto-start-scheduler.service';

describe('GameAutoStartSchedulerService', () => {
  const gameTimingConfigServiceMock = {
    getRegistrationDurationSeconds: jest.fn().mockResolvedValue(120),
    getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(9),
  };

  function createService(options?: {
    dueSessions?: Array<{ id: string; gameSlotId: string }>;
    claimCount?: number;
    dueSessionDetail?: Record<string, unknown> | null;
    queueProgressionSession?: Record<string, unknown> | null;
  }) {
    const tx = {
      gameSession: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      gameSlot: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const progressionTx = {
      gameSession: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(options?.queueProgressionSession ?? null),
      },
      gameSlot: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'slot-auto-head',
          operationMode: GameOperationMode.AUTO,
          entryFee: { toString: () => '10' },
          prizePerCartela: { toString: () => '8' },
          registrationDurationSeconds: 60,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      gameSession: {
        findMany: jest
          .fn()
          .mockResolvedValue(options?.dueSessions ?? []),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: options?.claimCount ?? 0 }),
        findUnique: jest.fn().mockResolvedValue(options?.dueSessionDetail ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
        if (options?.queueProgressionSession !== undefined) {
          return callback(progressionTx as never);
        }

        return callback(tx);
      }),
    };

    const gameEngineService = {
      startGame: jest.fn().mockResolvedValue({ id: 'session-1' }),
    };

    const autoCallService = {
      startAutoCall: jest.fn().mockResolvedValue({ success: true }),
    };

    const gameQueueService = {
      moveSlotToBack: jest.fn().mockResolvedValue(undefined),
    };

    const realtimeService = {
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const service = new GameAutoStartSchedulerService(
      prisma as never,
      gameEngineService as never,
      autoCallService as never,
      gameQueueService as never,
      realtimeService as never,
      gameTimingConfigServiceMock as never,
    );

    return {
      service,
      prisma,
      tx,
      progressionTx,
      gameEngineService,
      autoCallService,
      gameQueueService,
      realtimeService,
      gameTimingConfigService: gameTimingConfigServiceMock,
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

  it('starts game and auto-call after claiming a due READY session', async () => {
    const { service, prisma, gameEngineService, autoCallService } = createService(
      {
        dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
        claimCount: 1,
        dueSessionDetail: createDueSessionDetail(),
      },
    );

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
    expect(autoCallService.startAutoCall).toHaveBeenCalledWith('session-1');
  });

  it('skips when the READY claim update does not win', async () => {
    const { service, prisma, gameEngineService } = createService({
      dueSessions: [{ id: 'session-1', gameSlotId: 'slot-1' }],
      claimCount: 0,
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameEngineService.startGame).not.toHaveBeenCalled();
  });

  it('cancels empty READY sessions and moves the slot back', async () => {
    const tx = {
      gameSession: {
        update: jest.fn(),
      },
      gameSlot: {
        findUnique: jest.fn(),
      },
    };

    const prisma = {
      gameSession: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'session-1', gameSlotId: 'slot-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(
          createDueSessionDetail({
            _count: { gameCartelas: 0 },
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => {
          tx.gameSession.update.mockResolvedValueOnce({
            id: 'session-1',
            gameSlotId: 'slot-1',
            playCode: 'BINGO-AUTO1',
            entryFee: { toString: () => '10' },
            prizePerCartela: { toString: () => '8' },
            companyFeePerCartela: { toString: () => '2' },
            prizeAmount: { toString: () => '0' },
            companyRevenue: { toString: () => '0' },
            status: GameStatus.CANCELLED,
            autoCallEnabled: false,
            autoCallIntervalMs: 7000,
            nextAutoCallAt: null,
            scheduledStartAt: null,
            startedAt: new Date('2026-06-10T12:00:00.000Z'),
            finishedAt: null,
            winnerCartelaId: null,
            winnerWindowStartedAt: null,
            winnerWindowEndsAt: null,
            prizeFinalizedAt: null,
            createdAt: new Date('2026-06-10T12:00:00.000Z'),
            updatedAt: new Date('2026-06-10T12:00:00.000Z'),
            gameSlot: createOpenedSessionRecord().gameSlot,
            _count: { gameCartelas: 0, calledNumbers: 0 },
            gameCartelas: [],
            gameCartelaReservations: [],
          });
          tx.gameSlot.findUnique.mockResolvedValueOnce({
            ...createOpenedSessionRecord().gameSlot,
            sessions: [],
          });

          return callback(tx);
        })
        .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => {
          const progressionTx = {
            gameSession: {
              findFirst: jest
                .fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null),
              create: jest.fn(),
            },
            gameSlot: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'slot-auto-next',
                operationMode: GameOperationMode.AUTO,
                entryFee: { toString: () => '10' },
                prizePerCartela: { toString: () => '8' },
                registrationDurationSeconds: 60,
              }),
              update: jest.fn().mockResolvedValue({}),
            },
          };

          progressionTx.gameSession.create.mockResolvedValue(
            createOpenedSessionRecord(),
          );

          return callback(progressionTx as never);
        }),
    };

    const gameEngineService = { startGame: jest.fn() };
    const gameQueueService = { moveSlotToBack: jest.fn() };
    const realtimeService = {
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const service = new GameAutoStartSchedulerService(
      prisma as never,
      gameEngineService as never,
      { startAutoCall: jest.fn() } as never,
      gameQueueService as never,
      realtimeService as never,
      gameTimingConfigServiceMock as never,
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(gameEngineService.startGame).not.toHaveBeenCalled();
    expect(gameQueueService.moveSlotToBack).toHaveBeenCalledWith(tx, 'slot-1');
  });

  describe('queue progression', () => {
    it('opens READY registration for the next AUTO head slot when idle', async () => {
      const openedSession = createOpenedSessionRecord();
      const { service, progressionTx, realtimeService, gameTimingConfigService } =
        createService({
        queueProgressionSession: openedSession,
      });

      await (service as unknown as { tick: () => Promise<void> }).tick();

      expect(gameTimingConfigService.getRegistrationDurationSeconds).toHaveBeenCalled();
      expect(progressionTx.gameSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-auto-head' },
          data: expect.objectContaining({
            registrationDurationSeconds: 120,
            autoCallIntervalSeconds: 9,
          }),
        }),
      );
      expect(progressionTx.gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gameSlotId: 'slot-auto-head',
            status: GameStatus.READY,
            scheduledStartAt: expect.any(Date),
          }),
        }),
      );
      expect(realtimeService.emitGameOperationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          slotId: 'slot-auto-head',
          sessionId: 'session-auto-2',
        }),
      );
    });

    it('does not open registration when queue head is MANUAL', async () => {
      const tx = {
        gameSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        gameSlot: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'slot-manual-head',
            operationMode: GameOperationMode.MANUAL,
            entryFee: { toString: () => '10' },
            prizePerCartela: { toString: () => '8' },
            registrationDurationSeconds: null,
          }),
        },
      };

      const prisma = {
        gameSession: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
        },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      const service = new GameAutoStartSchedulerService(
        prisma as never,
        { startGame: jest.fn() } as never,
        { startAutoCall: jest.fn() } as never,
        { moveSlotToBack: jest.fn() } as never,
        { emitGameOperationUpdate: jest.fn() } as never,
        gameTimingConfigServiceMock as never,
      );

      await (service as unknown as { tick: () => Promise<void> }).tick();

      expect(tx.gameSession.create).not.toHaveBeenCalled();
    });

    it('does not duplicate an existing READY session for the AUTO head slot', async () => {
      const tx = {
        gameSession: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'existing-ready' }),
          create: jest.fn(),
        },
        gameSlot: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'slot-auto-head',
            operationMode: GameOperationMode.AUTO,
            entryFee: { toString: () => '10' },
            prizePerCartela: { toString: () => '8' },
            registrationDurationSeconds: 60,
          }),
        },
      };

      const prisma = {
        gameSession: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
        },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      const service = new GameAutoStartSchedulerService(
        prisma as never,
        { startGame: jest.fn() } as never,
        { startAutoCall: jest.fn() } as never,
        { moveSlotToBack: jest.fn() } as never,
        { emitGameOperationUpdate: jest.fn() } as never,
        gameTimingConfigServiceMock as never,
      );

      await (service as unknown as { tick: () => Promise<void> }).tick();

      expect(tx.gameSession.create).not.toHaveBeenCalled();
    });

    it('opens the next AUTO head slot after an empty registration is cancelled', async () => {
      const tx = {
        gameSession: {
          update: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        gameSlot: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
        },
      };

      const prisma = {
        gameSession: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'session-1', gameSlotId: 'slot-1' }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(
            createDueSessionDetail({ _count: { gameCartelas: 0 } }),
          ),
        },
        $transaction: jest
          .fn()
          .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) =>
            callback(tx),
          )
          .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => {
            const progressionTx = {
              gameSession: {
                findFirst: jest
                  .fn()
                  .mockResolvedValueOnce(null)
                  .mockResolvedValueOnce(null),
                create: jest.fn().mockResolvedValue(createOpenedSessionRecord()),
              },
              gameSlot: {
                findFirst: jest.fn().mockResolvedValue({
                  id: 'slot-auto-next',
                  operationMode: GameOperationMode.AUTO,
                  entryFee: { toString: () => '10' },
                  prizePerCartela: { toString: () => '8' },
                  registrationDurationSeconds: 60,
                }),
                update: jest.fn().mockResolvedValue({}),
              },
            };

            return callback(progressionTx as never);
          }),
      };

      tx.gameSession.update.mockResolvedValue({
        ...createOpenedSessionRecord(),
        id: 'session-1',
        status: GameStatus.CANCELLED,
      });
      tx.gameSlot.findUnique.mockResolvedValue({
        ...createOpenedSessionRecord().gameSlot,
        sessions: [],
      });

      const gameQueueService = { moveSlotToBack: jest.fn() };
      const realtimeService = {
        emitToSession: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      };

      const service = new GameAutoStartSchedulerService(
        prisma as never,
        { startGame: jest.fn() } as never,
        { startAutoCall: jest.fn() } as never,
        gameQueueService as never,
        realtimeService as never,
        gameTimingConfigServiceMock as never,
      );

      await (service as unknown as { tick: () => Promise<void> }).tick();

      expect(gameQueueService.moveSlotToBack).toHaveBeenCalled();
      expect(realtimeService.emitGameOperationUpdate).toHaveBeenCalled();
    });

    it('recovers after scheduler restart by opening the AUTO head slot when idle', async () => {
      const openedSession = createOpenedSessionRecord();
      const { service, progressionTx } = createService({
        dueSessions: [],
        queueProgressionSession: openedSession,
      });

      await (service as unknown as { tick: () => Promise<void> }).tick();

      expect(progressionTx.gameSession.create).toHaveBeenCalledTimes(1);
    });
  });
});
