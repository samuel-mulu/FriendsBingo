import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminBroadcastCategory } from '@prisma/client';
import { AdminBroadcastsService } from './admin-broadcasts.service';

describe('AdminBroadcastsService', () => {
  const broadcastId = '11111111-1111-4111-8111-111111111111';
  function buildRecord(
    overrides: Partial<{
      category: AdminBroadcastCategory;
      forcedLive: boolean;
      playerCanDismiss: boolean;
    }> = {},
  ) {
    return {
      id: broadcastId,
      title: 'Title',
      body: 'Body',
      category: AdminBroadcastCategory.DISMISSIBLE,
      forcedLive: false,
      playerCanDismiss: false,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      createdById: 'admin-1',
      ...overrides,
    };
  }

  function createService(options?: {
    findUnique?: jest.Mock;
    deleteManyDismissals?: jest.Mock;
    emit?: jest.Mock;
  }) {
    const emitToAllRealtimeClients = options?.emit ?? jest.fn();
    const findUnique = options?.findUnique ?? jest.fn();
    const deleteMany = options?.deleteManyDismissals ?? jest.fn();

    const prisma = {
      adminBroadcast: { findUnique },
      adminBroadcastDismissal: { deleteMany },
    };

    const service = new AdminBroadcastsService(
      prisma as never,
      { emitToAllRealtimeClients } as never,
    );

    return { service, emitToAllRealtimeClients, findUnique, deleteMany };
  }

  describe('remind', () => {
    it('clears dismissals and emits admin:broadcast_remind for dismissible', async () => {
      const record = buildRecord();
      const { service, deleteMany, emitToAllRealtimeClients, findUnique } =
        createService({
          findUnique: jest.fn().mockResolvedValue(record),
          deleteManyDismissals: jest.fn().mockResolvedValue({ count: 3 }),
        });

      const result = await service.remind(broadcastId);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { broadcastId },
      });
      expect(emitToAllRealtimeClients).toHaveBeenCalledWith(
        'admin:broadcast_remind',
        expect.objectContaining({ id: broadcastId }),
      );
      expect(result.id).toBe(broadcastId);
      expect(findUnique).toHaveBeenCalled();
    });

    it('rejects non-dismissible broadcasts', async () => {
      const { service } = createService({
        findUnique: jest
          .fn()
          .mockResolvedValue(
            buildRecord({ category: AdminBroadcastCategory.FORCED }),
          ),
      });

      await expect(service.remind(broadcastId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when broadcast missing', async () => {
      const { service } = createService({
        findUnique: jest.fn().mockResolvedValue(null),
      });

      await expect(service.remind(broadcastId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('dismissForUser', () => {
    it('allows dismissible broadcasts', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const prisma = {
        adminBroadcast: {
          findUnique: jest.fn().mockResolvedValue({
            id: broadcastId,
            category: AdminBroadcastCategory.DISMISSIBLE,
          }),
        },
        adminBroadcastDismissal: { upsert },
      };
      const service = new AdminBroadcastsService(
        prisma as never,
        { emitToAllRealtimeClients: jest.fn() } as never,
      );

      await service.dismissForUser('user-1', broadcastId);

      expect(upsert).toHaveBeenCalled();
    });

    it('rejects forced broadcasts', async () => {
      const prisma = {
        adminBroadcast: {
          findUnique: jest.fn().mockResolvedValue({
            id: broadcastId,
            category: AdminBroadcastCategory.FORCED,
          }),
        },
        adminBroadcastDismissal: { upsert: jest.fn() },
      };
      const service = new AdminBroadcastsService(
        prisma as never,
        { emitToAllRealtimeClients: jest.fn() } as never,
      );

      await expect(
        service.dismissForUser('user-1', broadcastId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setForcedLive', () => {
    it('turns off a live forced broadcast and emits removed', async () => {
      const emit = jest.fn();
      const update = jest.fn().mockResolvedValue(
        buildRecord({
          category: AdminBroadcastCategory.FORCED,
          forcedLive: false,
        }),
      );
      const prisma = {
        adminBroadcast: {
          findUnique: jest.fn().mockResolvedValue(
            buildRecord({
              category: AdminBroadcastCategory.FORCED,
              forcedLive: true,
            }),
          ),
          update,
        },
      };
      const service = new AdminBroadcastsService(
        prisma as never,
        { emitToAllRealtimeClients: emit } as never,
      );

      const result = await service.setForcedLive(broadcastId, false);

      expect(update).toHaveBeenCalledWith({
        where: { id: broadcastId },
        data: { forcedLive: false },
        select: expect.any(Object),
      });
      expect(emit).toHaveBeenCalledWith('admin:broadcast_removed', {
        id: broadcastId,
      });
      expect(result.forcedLive).toBe(false);
    });

    it('rejects non-forced broadcasts', async () => {
      const prisma = {
        adminBroadcast: {
          findUnique: jest
            .fn()
            .mockResolvedValue(buildRecord({ category: AdminBroadcastCategory.DISMISSIBLE })),
        },
      };
      const service = new AdminBroadcastsService(
        prisma as never,
        { emitToAllRealtimeClients: jest.fn() } as never,
      );

      await expect(service.setForcedLive(broadcastId, true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
