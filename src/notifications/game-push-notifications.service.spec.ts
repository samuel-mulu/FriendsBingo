import { GamePushMode } from '@prisma/client';
import { GamePushNotificationsService } from './game-push-notifications.service';
import {
  isBroadcastGameCategory,
  isSessionGameCategory,
} from './push-rate-policy';

describe('push-rate-policy game push modes', () => {
  it('classifies registration and big-game reminders as broadcast', () => {
    expect(isBroadcastGameCategory('REGISTRATION_OPEN')).toBe(true);
    expect(isBroadcastGameCategory('BIG_GAME_REGISTRATION_OPEN')).toBe(true);
    expect(isBroadcastGameCategory('BIG_GAME_TOMORROW')).toBe(true);
    expect(isBroadcastGameCategory('BIG_GAME_TODAY')).toBe(true);
    expect(isBroadcastGameCategory('GAME_STARTED')).toBe(false);
  });

  it('classifies session and personal game alerts as session', () => {
    expect(isSessionGameCategory('GAME_STARTED')).toBe(true);
    expect(isSessionGameCategory('BONUS_GAME_STARTED')).toBe(true);
    expect(isSessionGameCategory('WINNER_WINDOW_STARTED')).toBe(true);
    expect(isSessionGameCategory('GAME_FINISHED')).toBe(true);
    expect(isSessionGameCategory('WINNER_ANNOUNCEMENT')).toBe(true);
    expect(isSessionGameCategory('BIG_GAME_TICKET_GRANTED')).toBe(true);
    expect(isSessionGameCategory('REGISTRATION_OPEN')).toBe(false);
  });
});

describe('GamePushNotificationsService audience filters', () => {
  const prisma = {
    pushDevice: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  };

  const notificationsService = {
    sendAppNotificationToUsers: jest.fn(),
  };

  let service: GamePushNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GamePushNotificationsService(
      notificationsService as never,
      prisma as never,
    );
  });

  it('lists only ALWAYS users for broadcast audience', async () => {
    prisma.pushDevice.findMany.mockResolvedValue([
      { userId: 'always-1' },
      { userId: 'always-2' },
    ]);

    await expect(service.listBroadcastPushUserIds()).resolves.toEqual([
      'always-1',
      'always-2',
    ]);

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        user: { gamePushMode: GamePushMode.ALWAYS },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
  });

  it('filters session audience to exclude OFF only', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'always-user' },
      { id: 'registered-only-user' },
    ]);

    await expect(
      service.filterSessionPushUserIds([
        'always-user',
        'registered-only-user',
        'off-user',
        'always-user',
      ]),
    ).resolves.toEqual(['always-user', 'registered-only-user']);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['always-user', 'registered-only-user', 'off-user'],
        },
        gamePushMode: { not: GamePushMode.OFF },
      },
      select: { id: true },
    });
  });

  it('returns empty session audience without querying when no user ids', async () => {
    await expect(service.filterSessionPushUserIds([])).resolves.toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('skips session push send when all participants are OFF', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.notifyWinnerWindowStarted('session-1', ['off-user']);

    expect(notificationsService.sendAppNotificationToUsers).not.toHaveBeenCalled();
  });
});
