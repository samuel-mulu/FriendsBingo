import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AutoCallService } from './auto-call.service';

describe('AutoCallService', () => {
  function createService() {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'session-1', autoCallIntervalMs: 7000 },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const calledNumbersService = {
      callRandomNumber: jest.fn().mockResolvedValue({ id: 'called-1' }),
    };

    const realtimeService = {
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
    };

    const service = new AutoCallService(
      prisma as never,
      calledNumbersService as never,
      realtimeService as never,
    );

    return { service, prisma, calledNumbersService, realtimeService };
  }

  it('disables auto-call for terminal session errors', async () => {
    const { service, prisma, calledNumbersService } = createService();
    calledNumbersService.callRandomNumber.mockRejectedValue(
      new BadRequestException('All numbers have been called'),
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', autoCallEnabled: true },
        data: {
          autoCallEnabled: false,
          nextAutoCallAt: null,
        },
      }),
    );
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('keeps auto-call enabled for transient call conflicts', async () => {
    const { service, prisma, calledNumbersService } = createService();
    calledNumbersService.callRandomNumber.mockRejectedValue(
      new ConflictException('Called number already exists or ordering conflict occurred'),
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('advances nextAutoCallAt after a successful call', async () => {
    const { service, prisma } = createService();

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: {
          nextAutoCallAt: expect.any(Date),
        },
      }),
    );
  });

  it('does not crash the scheduler when session lookup fails', async () => {
    const { service, prisma } = createService();
    prisma.gameSession.findMany.mockRejectedValue(new Error('database unavailable'));

    await expect(
      (service as unknown as { tick: () => Promise<void> }).tick(),
    ).resolves.toBeUndefined();
  });
});
