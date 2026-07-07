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
    const postGameRegistrationOpenerService = {
      openNextAutoQueueRegistration: jest.fn().mockResolvedValue(false),
      openNextAutoQueueRegistrationInTransaction: jest
        .fn()
        .mockResolvedValue(null),
      finalizeOpenedRegistration: jest.fn().mockResolvedValue(false),
    };
    const operationsCacheService = {
      invalidate: jest.fn(),
    };
    const realtimeService = {
      emitGameCancelled: jest.fn(),
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const service = new GameLifecycleService(
      prisma as never,
      {} as never,
      {} as never,
      realtimeService as never,
      {} as never,
      operationsCacheService as never,
      autoCallService as never,
      postGameRegistrationOpenerService as never,
    );

    return {
      service,
      prisma,
      autoCallService,
      postGameRegistrationOpenerService,
      operationsCacheService,
      realtimeService,
    };
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

  it('opens the next READY before invalidating and emitting a committed cancel', async () => {
    const {
      service,
      prisma,
      postGameRegistrationOpenerService,
      operationsCacheService,
      realtimeService,
    } = createService();

    prisma.gameSession.findUnique
      .mockResolvedValueOnce({
        id: 'session-1',
        status: GameStatus.PLAYING,
        gameSlotId: 'slot-1',
        cancelledReason: null,
      })
      .mockResolvedValueOnce({
        id: 'session-1',
        status: GameStatus.CANCELLED,
        gameSlotId: 'slot-1',
        cancelledReason: 'admin_cancelled',
      });
    prisma.$transaction.mockResolvedValue({
      previousStatus: GameStatus.PLAYING,
      cancelledSession: {
        id: 'session-1',
        gameSlotId: 'slot-1',
        gameSlot: {
          id: 'slot-1',
          staticCode: 'CODE-1',
          name: 'Manual',
          gameType: 'MANUAL',
          status: GameStatus.NEXT,
          entryFee: { toString: () => '10' },
          prizePerCartela: { toString: () => '8' },
          sortOrder: 1,
          operationMode: 'AUTO',
          category: 'NORMAL',
          gameRule: null,
        },
        playCode: 'BINGO-1',
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
        companyFeePerCartela: { toString: () => '2' },
        prizeAmount: { toString: () => '0' },
        companyRevenue: { toString: () => '0' },
        status: GameStatus.CANCELLED,
        startedAt: new Date('2026-06-06T10:00:00.000Z'),
        finishedAt: null,
        winnerCartelaId: null,
        cancelledReason: 'admin_cancelled',
        nextAutoCallAt: null,
        winnerWindowEndsAt: null,
        noWinnerGraceEndsAt: null,
        noWinnerReason: null,
        autoCallEnabled: false,
        autoCallIntervalMs: null,
        registrationOpensAt: null,
        scheduledStartAt: null,
        createdAt: new Date('2026-06-06T10:00:00.000Z'),
        updatedAt: new Date('2026-06-06T10:00:00.000Z'),
        _count: { gameCartelas: 0, calledNumbers: 0 },
        gameCartelas: [],
        calledNumbers: [],
      },
      updatedSlot: {
        id: 'slot-1',
        staticCode: 'CODE-1',
        name: 'Manual',
        gameType: 'MANUAL',
        status: GameStatus.NEXT,
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
        sortOrder: 1,
        operationMode: 'AUTO',
        category: 'NORMAL',
        gameRule: null,
        sessions: [],
        createdAt: new Date('2026-06-06T09:00:00.000Z'),
        updatedAt: new Date('2026-06-06T10:00:00.000Z'),
      },
      openedRegistration: null,
      refundedUserIds: [],
      refundedCount: 0,
    });

    await service.cancelSession('session-1', 'admin_cancelled');

    expect(
      postGameRegistrationOpenerService.finalizeOpenedRegistration
        .mock.invocationCallOrder[0],
    ).toBeLessThan(operationsCacheService.invalidate.mock.invocationCallOrder[0]);
    expect(
      postGameRegistrationOpenerService.finalizeOpenedRegistration
        .mock.invocationCallOrder[0],
    ).toBeLessThan(realtimeService.emitToSession.mock.invocationCallOrder[0]);
  });
});
