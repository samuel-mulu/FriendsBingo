import { GameCategory, GameStatus } from '@prisma/client';
import { GamePushNotificationsService } from './game-push-notifications.service';

describe('GamePushNotificationsService', () => {
  const notificationsService = {
    sendAppNotificationToUsers: jest.fn().mockResolvedValue({
      userCount: 1,
      sentCount: 1,
      failedCount: 0,
    }),
  };

  const prisma = {
    pushDevice: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
    },
    gameSession: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  function createService() {
    return new GamePushNotificationsService(
      notificationsService as never,
      prisma as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('broadcasts REGISTRATION_OPEN for normal games', async () => {
    const service = createService();
    const session = {
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'A1',
      status: GameStatus.READY,
      gameSlot: {
        category: GameCategory.NORMAL,
        name: 'Evening Bingo',
        fixedPrizeAmount: null,
      },
      prizeAmount: { toString: () => '50' },
      scheduledStartAt: null,
      registrationOpensAt: new Date('2026-06-25T10:00:00.000Z'),
    };

    await service.notifyRegistrationOpened(session as never);

    expect(notificationsService.sendAppNotificationToUsers).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({
        category: 'REGISTRATION_OPEN',
        route: '/games',
        entityId: 'session-1',
      }),
    );
  });

  it('broadcasts BIG_GAME_REGISTRATION_OPEN for big games', async () => {
    const service = createService();
    const session = {
      id: 'session-big',
      gameSlotId: 'slot-big',
      playCode: null,
      status: GameStatus.READY,
      gameSlot: {
        category: GameCategory.BIG_GAME,
        name: 'Saturday Big Game',
        fixedPrizeAmount: { toString: () => '10000' },
      },
      prizeAmount: { toString: () => '10000' },
      scheduledStartAt: new Date('2026-06-26T18:00:00.000Z'),
      registrationOpensAt: new Date('2026-06-25T10:00:00.000Z'),
    };

    await service.notifyRegistrationOpened(session as never);

    expect(notificationsService.sendAppNotificationToUsers).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({
        category: 'BIG_GAME_REGISTRATION_OPEN',
        route: '/games/big-game',
      }),
    );
  });

  it('sends registration-open pushes for each session', async () => {
    const service = createService();
    const session = {
      id: 'session-dedupe',
      gameSlotId: 'slot-1',
      playCode: 'B2',
      status: GameStatus.READY,
      gameSlot: {
        category: GameCategory.NORMAL,
        name: 'Dedupe Game',
        fixedPrizeAmount: null,
      },
      prizeAmount: { toString: () => '25' },
      scheduledStartAt: null,
      registrationOpensAt: null,
    };

    await service.notifyRegistrationOpened(session as never);

    expect(notificationsService.sendAppNotificationToUsers).toHaveBeenCalledTimes(
      1,
    );
  });

  it('sends BONUS_GAME_STARTED to registered users only', async () => {
    const service = createService();
    const session = {
      id: 'session-bonus',
      gameSlotId: 'slot-bonus',
      playCode: 'FREE',
      status: GameStatus.PLAYING,
      gameSlot: {
        category: GameCategory.BONUS,
        name: 'Bonus Round',
        fixedPrizeAmount: null,
      },
      prizeAmount: { toString: () => '0' },
      scheduledStartAt: null,
      registrationOpensAt: null,
    };

    await service.notifyGameStarted(session as never, ['user-9']);

    expect(notificationsService.sendAppNotificationToUsers).toHaveBeenCalledWith(
      ['user-9'],
      expect.objectContaining({
        category: 'BONUS_GAME_STARTED',
        route: '/games?sessionId=session-bonus',
      }),
    );
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
  });
});
