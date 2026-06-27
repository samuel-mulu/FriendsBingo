import { GameStatus } from '@prisma/client';
import { GamesService } from './games.service';

describe('GamesService.clearQueue', () => {
  function createClearQueueService(options?: {
    protectedSessions?: Array<{ gameSlotId: string }>;
    registrationSession?: {
      id: string;
      gameSlotId: string;
      cartelaCount: number;
    } | null;
    batchClearCount?: number;
    nonNextClearCount?: number;
    registrationSlotStatus?: GameStatus;
  }) {
    const updateMany = jest
      .fn()
      .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (
          where.status === GameStatus.NEXT ||
          (Array.isArray(where.status) === false &&
            where.status === GameStatus.NEXT)
        ) {
          return Promise.resolve({ count: options?.batchClearCount ?? 0 });
        }

        if (
          where.status &&
          typeof where.status === 'object' &&
          'notIn' in (where.status as object)
        ) {
          return Promise.resolve({ count: options?.nonNextClearCount ?? 0 });
        }

        return Promise.resolve({ count: options?.batchClearCount ?? 0 });
      });

    const prisma = {
      gameSession: {
        findMany: jest
          .fn()
          .mockResolvedValue(options?.protectedSessions ?? []),
        findFirst: jest.fn().mockResolvedValue(
          options?.registrationSession
            ? {
                id: options.registrationSession.id,
                gameSlotId: options.registrationSession.gameSlotId,
                _count: {
                  gameCartelas: options.registrationSession.cartelaCount,
                },
              }
            : null,
        ),
        updateMany: jest.fn(),
      },
      gameSlot: {
        updateMany,
      },
    };

    const gameLifecycleService = {
      cancelSession: jest.fn().mockResolvedValue({
        aborted: false,
        sessionId: options?.registrationSession?.id,
        slotId: options?.registrationSession?.gameSlotId,
        reason: 'queue_cleared',
        refundedCount: 0,
      }),
    };

    const operationsCacheService = { invalidate: jest.fn() };
    const realtimeService = {
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
    };
    const auditLogService = { create: jest.fn() };

    const service = Object.create(GamesService.prototype) as GamesService;
    Object.assign(service, {
      prisma,
      gameLifecycleService,
      operationsCacheService,
      realtimeService,
      auditLogService,
      updateSlotStatus: jest.fn(),
    });

    return {
      service,
      gameLifecycleService,
      prisma,
      operationsCacheService,
      realtimeService,
      auditLogService,
      updateMany,
    };
  }

  it('clears empty READY registration and remaining NEXT slots in one batch', async () => {
    const { service, gameLifecycleService, updateMany } =
      createClearQueueService({
        registrationSession: {
          id: 'session-ready',
          gameSlotId: 'slot-reg',
          cartelaCount: 0,
        },
        batchClearCount: 3,
      });
    const updateSlotStatusSpy = (service as { updateSlotStatus: jest.Mock })
      .updateSlotStatus;

    const result = await service.clearQueue('admin-1');

    expect(gameLifecycleService.cancelSession).toHaveBeenCalledWith(
      'session-ready',
      'queue_cleared',
      expect.objectContaining({ requeueSlot: false, actorId: 'admin-1' }),
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: GameStatus.NEXT,
        category: { not: 'BIG_GAME' },
      },
      data: { status: GameStatus.CANCELLED },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'slot-reg',
        status: { notIn: [GameStatus.CANCELLED, GameStatus.NEXT] },
      },
      data: { status: GameStatus.CANCELLED },
    });
    expect(updateSlotStatusSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      clearedSlotsCount: 3,
      cancelledEmptyRegistration: true,
      keptRegistration: false,
    });
  });

  it('keeps registration with cartelas and clears only waiting queue slots', async () => {
    const { service, gameLifecycleService, updateMany } =
      createClearQueueService({
        registrationSession: {
          id: 'session-ready',
          gameSlotId: 'slot-reg',
          cartelaCount: 3,
        },
        batchClearCount: 1,
      });

    const result = await service.clearQueue('admin-1');

    expect(gameLifecycleService.cancelSession).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: GameStatus.NEXT,
        category: { not: 'BIG_GAME' },
        id: { notIn: ['slot-reg'] },
      },
      data: { status: GameStatus.CANCELLED },
    });
    expect(result).toEqual({
      clearedSlotsCount: 1,
      cancelledEmptyRegistration: false,
      keptRegistration: true,
    });
  });

  it('keeps live games and clears only waiting queue slots', async () => {
    const { service, updateMany } = createClearQueueService({
      protectedSessions: [{ gameSlotId: 'slot-live' }],
      batchClearCount: 2,
    });

    const result = await service.clearQueue('admin-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: GameStatus.NEXT,
        category: { not: 'BIG_GAME' },
        id: { notIn: ['slot-live'] },
      },
      data: { status: GameStatus.CANCELLED },
    });
    expect(result).toEqual({
      clearedSlotsCount: 2,
      cancelledEmptyRegistration: false,
      keptRegistration: false,
    });
  });

  it('is idempotent when the queue is already clear', async () => {
    const { service, auditLogService } = createClearQueueService({
      batchClearCount: 0,
    });

    await expect(service.clearQueue('admin-1')).resolves.toEqual({
      clearedSlotsCount: 0,
      cancelledEmptyRegistration: false,
      keptRegistration: false,
    });
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it('does not call updateSlotStatus per slot (batch only)', async () => {
    const { service, updateMany } = createClearQueueService({
      batchClearCount: 5,
    });
    const updateSlotStatusSpy = (service as { updateSlotStatus: jest.Mock })
      .updateSlotStatus;

    await service.clearQueue('admin-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateSlotStatusSpy).not.toHaveBeenCalled();
  });

  it('does not cancel sessions when clearing requeued NEXT slots', async () => {
    const { service, prisma } = createClearQueueService({
      batchClearCount: 4,
    });

    await service.clearQueue('admin-1');

    expect(prisma.gameSession.updateMany).not.toHaveBeenCalled();
  });

  it('cancels empty registration slot when it is not NEXT', async () => {
    const { service, updateMany } = createClearQueueService({
      registrationSession: {
        id: 'session-ready',
        gameSlotId: 'slot-reg',
        cartelaCount: 0,
      },
      batchClearCount: 2,
      nonNextClearCount: 1,
    });

    const result = await service.clearQueue('admin-1');

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'slot-reg',
        status: { notIn: [GameStatus.CANCELLED, GameStatus.NEXT] },
      },
      data: { status: GameStatus.CANCELLED },
    });
    expect(result.clearedSlotsCount).toBe(3);
  });

  it('emits one admin operation update with queue_cleared reason', async () => {
    const { service, realtimeService, operationsCacheService } =
      createClearQueueService({
        batchClearCount: 2,
      });

    await service.clearQueue('admin-1');

    expect(operationsCacheService.invalidate).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToAdmin).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToAdmin).toHaveBeenCalledWith(
      'game:operation_updated',
      expect.objectContaining({
        updatedReason: 'queue_cleared',
        clearedSlotsCount: 2,
      }),
    );
    expect(realtimeService.emitToPublicGames).toHaveBeenCalledTimes(1);
  });

  it('records audit log when slots are cleared', async () => {
    const { service, auditLogService } = createClearQueueService({
      batchClearCount: 1,
    });

    await service.clearQueue('admin-1');

    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'admin.queue.clear',
      }),
    );
  });
});
