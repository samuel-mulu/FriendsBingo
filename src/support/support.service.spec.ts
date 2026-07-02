import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PlayerSupportCategory,
  PlayerSupportStatus,
} from '@prisma/client';
import { SupportService } from './support.service';

describe('SupportService', () => {
  const messageRecord = {
    id: 'msg-1',
    userId: 'user-1',
    category: PlayerSupportCategory.FEEDBACK,
    message: 'Great app',
    status: PlayerSupportStatus.OPEN,
    adminReply: null,
    repliedAt: null,
    repliedById: null,
    createdAt: new Date('2026-07-02T10:00:00.000Z'),
    updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    user: {
      id: 'user-1',
      fullName: 'Test Player',
      phoneNumber: '251911111111',
    },
  };

  function createService() {
    const prisma = {
      playerSupportMessage: {
        create: jest.fn().mockResolvedValue(messageRecord),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([messageRecord]),
        findUnique: jest.fn().mockResolvedValue(messageRecord),
        update: jest.fn().mockResolvedValue({
          ...messageRecord,
          adminReply: 'Thanks!',
          status: PlayerSupportStatus.REPLIED,
          repliedAt: new Date('2026-07-02T11:00:00.000Z'),
          repliedById: 'admin-1',
        }),
      },
    };
    const userActionRateLimitService = {
      assertWithinLimit: jest.fn(),
    };
    const realtimeService = {
      emitToAdmin: jest.fn(),
    };

    const service = new SupportService(
      prisma as never,
      userActionRateLimitService as never,
      realtimeService as never,
    );

    return { service, prisma, userActionRateLimitService, realtimeService };
  }

  it('creates a support message and notifies admin', async () => {
    const { service, realtimeService } = createService();

    const result = await service.createMessage('user-1', {
      category: PlayerSupportCategory.FEEDBACK,
      message: 'Great app',
    });

    expect(result.message).toBe('Great app');
    expect(realtimeService.emitToAdmin).toHaveBeenCalledWith(
      'support:new_message',
      expect.objectContaining({ id: 'msg-1' }),
    );
  });

  it('lists only the requesting player messages', async () => {
    const { service, prisma } = createService();

    await service.findMyMessages('user-1', { page: 1, pageSize: 20 });

    expect(prisma.playerSupportMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
      }),
    );
  });

  it('replies as admin and marks message replied', async () => {
    const { service, prisma } = createService();

    const result = await service.replyAsAdmin('msg-1', 'admin-1', {
      adminReply: 'Thanks!',
    });

    expect(prisma.playerSupportMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({
          adminReply: 'Thanks!',
          status: PlayerSupportStatus.REPLIED,
        }),
      }),
    );
    expect(result.adminReply).toBe('Thanks!');
  });

  it('rejects empty admin patch payload', async () => {
    const { service } = createService();

    await expect(
      service.replyAsAdmin('msg-1', 'admin-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when admin message is missing', async () => {
    const { service, prisma } = createService();
    prisma.playerSupportMessage.findUnique.mockResolvedValue(null);

    await expect(
      service.findAdminMessageById('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
