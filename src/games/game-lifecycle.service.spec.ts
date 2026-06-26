import { GameStatus } from '@prisma/client';
import { GameLifecycleService } from './game-lifecycle.service';

describe('GameLifecycleService.cancelSession', () => {
  function createService() {
    const prisma = {
      gameSession: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const autoCallService = {
      disableAutoCall: jest.fn().mockResolvedValue(undefined),
    };

    const service = new GameLifecycleService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      autoCallService as never,
    );

    return { service, prisma, autoCallService };
  }

  it('stops auto-call before opening the cancel transaction', async () => {
    const { service, prisma, autoCallService } = createService();
    const callOrder: string[] = [];

    prisma.gameSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: GameStatus.PLAYING,
      gameSlotId: 'slot-1',
      cancelledReason: null,
    });
    autoCallService.disableAutoCall.mockImplementation(async () => {
      callOrder.push('disableAutoCall');
    });
    prisma.$transaction.mockImplementation(async () => {
      callOrder.push('transaction');
      throw new Error('stop');
    });

    await expect(
      service.cancelSession('session-1', 'admin_cancelled', {
        actorId: 'admin-1',
      }),
    ).rejects.toThrow('stop');

    expect(autoCallService.disableAutoCall).toHaveBeenCalledWith('session-1');
    expect(callOrder).toEqual(['disableAutoCall', 'transaction']);
  });

  it('returns already-cancelled without touching auto-call', async () => {
    const { service, prisma, autoCallService } = createService();

    prisma.gameSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: GameStatus.CANCELLED,
      gameSlotId: 'slot-1',
      cancelledReason: 'admin_cancelled',
    });

    const result = await service.cancelSession('session-1', 'admin_cancelled');

    expect(result).toEqual(
      expect.objectContaining({
        aborted: false,
        alreadyCancelled: true,
        sessionId: 'session-1',
      }),
    );
    expect(autoCallService.disableAutoCall).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
