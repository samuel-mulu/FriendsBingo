import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminBroadcastCategory } from '@prisma/client';
import { AdminBroadcastsService } from './admin-broadcasts.service';

describe('AdminBroadcastsService', () => {
  function createService() {
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
      adminBroadcast: {
        create: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
      },
      adminBroadcastDismissal: {
        upsert: jest.fn(),
      },
    };
    const realtimeService = {
      emitToPublicGames: jest.fn(),
      emitToAllRealtimeClients: jest.fn(),
    };

    const service = new AdminBroadcastsService(
      prisma as never,
      realtimeService as never,
    );

    return { service, prisma, realtimeService };
  }

  it('creates a broadcast and emits admin:broadcast', async () => {
    const { service, prisma, realtimeService } = createService();
    const createdAt = new Date('2026-06-30T12:00:00.000Z');

    prisma.adminBroadcast.create.mockResolvedValue({
      id: 'broadcast-1',
      title: 'Hello',
      body: 'World',
      category: AdminBroadcastCategory.DISMISSIBLE,
      createdAt,
      createdById: 'admin-1',
    });

    await expect(
      service.create('admin-1', { title: 'Hello', body: 'World' }),
    ).resolves.toEqual({
      id: 'broadcast-1',
      title: 'Hello',
      body: 'World',
      category: AdminBroadcastCategory.DISMISSIBLE,
      createdAt: createdAt.toISOString(),
      createdById: 'admin-1',
    });

    expect(realtimeService.emitToAllRealtimeClients).toHaveBeenCalledWith(
      'admin:broadcast',
      expect.objectContaining({ id: 'broadcast-1' }),
    );
  });

  it('returns inbox and forced broadcasts separately for a player', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-06-30T12:00:00.000Z');

    prisma.adminBroadcast.findMany.mockResolvedValue([
      {
        id: 'forced-1',
        title: 'Maintenance',
        body: 'Soon',
        category: AdminBroadcastCategory.FORCED,
        createdAt,
        createdById: 'admin-1',
      },
      {
        id: 'persistent-1',
        title: 'Notice',
        body: 'Always visible',
        category: AdminBroadcastCategory.PERSISTENT,
        createdAt,
        createdById: 'admin-1',
      },
      {
        id: 'dismissible-1',
        title: 'Hello',
        body: 'World',
        category: AdminBroadcastCategory.DISMISSIBLE,
        createdAt,
        createdById: 'admin-1',
      },
    ]);

    await expect(service.findForUser('player-1')).resolves.toEqual({
      broadcasts: [
        expect.objectContaining({
          id: 'persistent-1',
          category: AdminBroadcastCategory.PERSISTENT,
        }),
        expect.objectContaining({
          id: 'dismissible-1',
          category: AdminBroadcastCategory.DISMISSIBLE,
        }),
      ],
      forcedBroadcast: expect.objectContaining({
        id: 'forced-1',
        category: AdminBroadcastCategory.FORCED,
      }),
      unreadCount: 1,
    });
  });

  it('rejects dismiss for non-dismissible broadcasts', async () => {
    const { service, prisma } = createService();

    prisma.adminBroadcast.findUnique.mockResolvedValue({
      id: 'persistent-1',
      category: AdminBroadcastCategory.PERSISTENT,
    });

    await expect(
      service.dismissForUser('player-1', 'persistent-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('emits admin:broadcast_removed when deleting', async () => {
    const { service, prisma, realtimeService } = createService();
    prisma.adminBroadcast.delete.mockResolvedValue({ id: 'broadcast-1' });

    await expect(service.delete('broadcast-1')).resolves.toEqual({
      success: true,
    });

    expect(realtimeService.emitToAllRealtimeClients).toHaveBeenCalledWith(
      'admin:broadcast_removed',
      { id: 'broadcast-1' },
    );
  });

  it('throws when deleting a missing broadcast', async () => {
    const { service, prisma } = createService();
    prisma.adminBroadcast.delete.mockRejectedValue(new Error('not found'));

    await expect(service.delete('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
