import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { AppPushNotificationPayload } from './types/push-category.type';

const sendMock = jest.fn();

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({
    send: sendMock,
  })),
}));

function firebaseError(
  code: string,
  message = 'Requested entity was not found.',
) {
  const error = new Error(message) as Error & {
    code: string;
    errorInfo: { code: string; message: string };
  };
  error.code = code;
  error.errorInfo = { code, message };
  return error;
}

describe('NotificationsService', () => {
  const payload: AppPushNotificationPayload = {
    category: 'REGISTRATION_OPEN',
    title: 'Open',
    body: 'Body',
    entityId: ' session-1 ',
    route: '/games',
  };

  let prisma: {
    pushDevice: {
      findMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    pushDeliveryLog: {
      create: jest.Mock;
    };
  };
  let configService: {
    get: jest.Mock;
  };
  let pushDeliveryGuard: {
    filterUsersForPush: jest.Mock;
    recordSuccessfulPush: jest.Mock;
    reserveDeliveries: jest.Mock;
  };
  let observability: {
    startPushBatch: jest.Mock;
    recordPushDelivery: jest.Mock;
  };
  let requestContext: {
    getRequestIdForLog: jest.Mock;
  };
  let service: NotificationsService;

  beforeEach(() => {
    sendMock.mockReset();
    prisma = {
      pushDevice: {
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      pushDeliveryLog: {
        create: jest.fn(),
      },
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PUSH_NOTIFICATIONS_ENABLED') {
          return true;
        }
        return undefined;
      }),
    };
    pushDeliveryGuard = {
      filterUsersForPush: jest.fn(),
      recordSuccessfulPush: jest.fn(),
      reserveDeliveries: jest.fn(),
    };
    observability = {
      startPushBatch: jest.fn(() => jest.fn()),
      recordPushDelivery: jest.fn(),
    };
    requestContext = {
      getRequestIdForLog: jest.fn(() => 'req-1'),
    };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new NotificationsService(
      prisma as never,
      configService as never,
      pushDeliveryGuard as never,
      observability as never,
      requestContext as never,
      {} as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses one reservation call and one device query for a 264-user broadcast', async () => {
    const requestedUsers = Array.from(
      { length: 264 },
      (_, index) => `user-${index}`,
    );
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(requestedUsers);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: requestedUsers,
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue(
      requestedUsers.map((userId, index) => ({
        id: `device-${index}`,
        userId,
        fcmToken: `token-${index}`,
      })),
    );
    sendMock.mockResolvedValue('ok');
    const sendToUserSpy = jest.spyOn(service, 'sendToUser');

    const summary = await service.sendAppNotificationToUsers(
      requestedUsers,
      payload,
    );

    expect(pushDeliveryGuard.reserveDeliveries).toHaveBeenCalledTimes(1);
    expect(prisma.pushDevice.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.pushDeliveryLog.create).not.toHaveBeenCalled();
    expect(sendToUserSpy).not.toHaveBeenCalled();
    expect(summary.requestedUsers).toBe(264);
    expect(summary.reservedUsers).toBe(264);
  });

  it('deduplicates requested users before reservation', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-1',
      'user-2',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-1', 'user-2'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([]);

    await service.sendAppNotificationToUsers(
      ['user-1', 'user-1', '', 'user-2'],
      payload,
    );

    expect(pushDeliveryGuard.filterUsersForPush).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      payload,
    );
    expect(pushDeliveryGuard.reserveDeliveries).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      payload,
    );
  });

  it('returns a clean zero summary when no users are eligible', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([]);

    const summary = await service.sendAppNotificationToUsers(
      ['user-1'],
      payload,
    );

    expect(pushDeliveryGuard.reserveDeliveries).not.toHaveBeenCalled();
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.eligibleUsers).toBe(0);
    expect(summary.reservedUsers).toBe(0);
  });

  it('skips device lookup and Firebase when all users are already reserved', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-a',
      'user-b',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: [],
      skippedDuplicates: 2,
    });

    const summary = await service.sendAppNotificationToUsers(
      ['user-a', 'user-b'],
      payload,
    );

    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.reservedUsers).toBe(0);
    expect(summary.duplicateUsersSkipped).toBe(2);
  });

  it('only sends Firebase notifications to reserved users', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-a',
      'user-b',
      'user-c',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a', 'user-c'],
      skippedDuplicates: 1,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-a', userId: 'user-a', fcmToken: 'token-a' },
      { id: 'device-c', userId: 'user-c', fcmToken: 'token-c' },
    ]);
    sendMock.mockResolvedValue('ok');

    const summary = await service.sendAppNotificationToUsers(
      ['user-a', 'user-b', 'user-c'],
      payload,
    );

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ['user-a', 'user-c'] },
        enabled: true,
      },
      select: {
        id: true,
        userId: true,
        fcmToken: true,
      },
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(summary.duplicateUsersSkipped).toBe(1);
    expect(summary.reservedUsers).toBe(2);
  });

  it('counts multiple devices for one user without inflating user counts', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
      { id: 'device-2', userId: 'user-a', fcmToken: 'token-2' },
    ]);
    sendMock.mockResolvedValue('ok');

    const summary = await service.sendAppNotificationToUsers(
      ['user-a'],
      payload,
    );

    expect(summary.usersWithDevices).toBe(1);
    expect(summary.deviceCount).toBe(2);
    expect(summary.deviceSendsSucceeded).toBe(2);
  });

  it('counts reserved users with no enabled devices separately', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-a',
      'user-b',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a', 'user-b'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
    ]);
    sendMock.mockResolvedValue('ok');

    const summary = await service.sendAppNotificationToUsers(
      ['user-a', 'user-b'],
      payload,
    );

    expect(summary.usersWithDevices).toBe(1);
    expect(summary.usersWithoutDevices).toBe(1);
    expect(summary.deviceSendsFailed).toBe(0);
  });

  it('disables invalid tokens and continues sending to other devices', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      {
        id: 'device-bad',
        userId: 'user-a',
        fcmToken: 'bad-token-12345678',
      },
      {
        id: 'device-good',
        userId: 'user-a',
        fcmToken: 'good-token-87654321',
      },
    ]);
    prisma.pushDevice.update.mockResolvedValue({});
    sendMock
      .mockRejectedValueOnce(new Error('registration-token-not-registered'))
      .mockResolvedValueOnce('ok');

    const summary = await service.sendAppNotificationToUsers(
      ['user-a'],
      payload,
    );

    expect(prisma.pushDevice.update).toHaveBeenCalledTimes(1);
    expect(summary.invalidTokensDisabled).toBe(1);
    expect(summary.deviceSendsSucceeded).toBe(1);
    expect(summary.deviceSendsFailed).toBe(1);
  });

  describe('Firebase invalid token classification', () => {
    const fullToken = 'fcm-token-SHOULD-NOT-APPEAR-abcdefgh';

    async function sendToUserA(
      devices: Array<{ id: string; userId: string; fcmToken: string }>,
    ) {
      pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
      pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
        reservedUserIds: ['user-a'],
        skippedDuplicates: 0,
      });
      prisma.pushDevice.findMany.mockResolvedValue(devices);
      return service.sendAppNotificationToUsers(['user-a'], payload);
    }

    function warnLogs() {
      return (Logger.prototype.warn as unknown as jest.Mock).mock.calls.map(
        (call) => String(call[0]),
      );
    }

    it('disables a token when Firebase code is messaging/registration-token-not-registered', async () => {
      prisma.pushDevice.update.mockResolvedValue({});
      sendMock.mockRejectedValueOnce(
        firebaseError('messaging/registration-token-not-registered'),
      );

      const summary = await sendToUserA([
        { id: 'device-bad', userId: 'user-a', fcmToken: fullToken },
      ]);

      expect(prisma.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-bad' },
        data: {
          enabled: false,
          lastSeenAt: expect.any(Date),
        },
      });
      expect(summary.invalidTokensDisabled).toBe(1);
      expect(summary.failureCodes).toEqual({
        'messaging/registration-token-not-registered': 1,
      });
      expect(warnLogs().join('\n')).toContain(
        'push_send_failed code=messaging/registration-token-not-registered deviceId=device-bad tokenSuffix=abcdefgh',
      );
      expect(warnLogs().join('\n')).not.toContain(fullToken);
    });

    it('disables a token when Firebase code is messaging/invalid-registration-token', async () => {
      prisma.pushDevice.update.mockResolvedValue({});
      sendMock.mockRejectedValueOnce(
        firebaseError('messaging/invalid-registration-token'),
      );

      const summary = await sendToUserA([
        { id: 'device-bad', userId: 'user-a', fcmToken: fullToken },
      ]);

      expect(prisma.pushDevice.update).toHaveBeenCalledTimes(1);
      expect(summary.invalidTokensDisabled).toBe(1);
      expect(summary.failureCodes).toEqual({
        'messaging/invalid-registration-token': 1,
      });
    });

    it('disables a token when the same codes are provided via errorInfo.code', async () => {
      prisma.pushDevice.update.mockResolvedValue({});
      sendMock
        .mockRejectedValueOnce({
          message: 'Requested entity was not found.',
          errorInfo: {
            code: 'messaging/registration-token-not-registered',
          },
        })
        .mockRejectedValueOnce({
          message: 'The registration token is not a valid FCM registration token',
          errorInfo: {
            code: 'messaging/invalid-registration-token',
          },
        });

      const summary = await sendToUserA([
        { id: 'device-bad-1', userId: 'user-a', fcmToken: 'token-1' },
        { id: 'device-bad-2', userId: 'user-a', fcmToken: 'token-2' },
      ]);

      expect(prisma.pushDevice.update).toHaveBeenCalledTimes(2);
      expect(summary.invalidTokensDisabled).toBe(2);
    });

    it('does not disable tokens for transient Firebase errors', async () => {
      sendMock
        .mockRejectedValueOnce(firebaseError('messaging/internal-error'))
        .mockRejectedValueOnce(firebaseError('messaging/server-unavailable'))
        .mockRejectedValueOnce(firebaseError('messaging/quota-exceeded'))
        .mockRejectedValueOnce(firebaseError('ETIMEDOUT', 'timed out'));

      const summary = await sendToUserA([
        { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
        { id: 'device-2', userId: 'user-a', fcmToken: 'token-2' },
        { id: 'device-3', userId: 'user-a', fcmToken: 'token-3' },
        { id: 'device-4', userId: 'user-a', fcmToken: 'token-4' },
      ]);

      expect(prisma.pushDevice.update).not.toHaveBeenCalled();
      expect(summary.invalidTokensDisabled).toBe(0);
      expect(summary.deviceSendsFailed).toBe(4);
      expect(summary.failureCodes).toEqual({
        'messaging/internal-error': 1,
        'messaging/server-unavailable': 1,
        'messaging/quota-exceeded': 1,
        ETIMEDOUT: 1,
      });
    });

    it('does not disable a token for an unknown Error', async () => {
      sendMock.mockRejectedValueOnce(new Error('send failed'));

      const summary = await sendToUserA([
        { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
      ]);

      expect(prisma.pushDevice.update).not.toHaveBeenCalled();
      expect(summary.invalidTokensDisabled).toBe(0);
      expect(summary.failureCodes).toEqual({ unknown: 1 });
    });

    it('leaves a successful token enabled', async () => {
      sendMock.mockResolvedValueOnce('ok');

      const summary = await sendToUserA([
        { id: 'device-good', userId: 'user-a', fcmToken: 'good-token' },
      ]);

      expect(prisma.pushDevice.update).not.toHaveBeenCalled();
      expect(summary.invalidTokensDisabled).toBe(0);
      expect(summary.deviceSendsSucceeded).toBe(1);
      expect(summary.failureCodes).toEqual({});
    });

    it('counts invalidTokensDisabled correctly across mixed broadcast results', async () => {
      prisma.pushDevice.update.mockResolvedValue({});
      sendMock
        .mockRejectedValueOnce(
          firebaseError('messaging/registration-token-not-registered'),
        )
        .mockRejectedValueOnce(
          firebaseError('messaging/invalid-registration-token'),
        )
        .mockResolvedValueOnce('ok');

      const summary = await sendToUserA([
        { id: 'device-bad-1', userId: 'user-a', fcmToken: 'bad-1' },
        { id: 'device-bad-2', userId: 'user-a', fcmToken: 'bad-2' },
        { id: 'device-good', userId: 'user-a', fcmToken: 'good' },
      ]);

      expect(prisma.pushDevice.update).toHaveBeenCalledTimes(2);
      expect(summary.invalidTokensDisabled).toBe(2);
      expect(summary.deviceSendsSucceeded).toBe(1);
      expect(summary.deviceSendsFailed).toBe(2);
      expect(summary.failureCodes).toEqual({
        'messaging/registration-token-not-registered': 1,
        'messaging/invalid-registration-token': 1,
      });
    });
  });

  it('resolves safely on partial Firebase failure', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
      { id: 'device-2', userId: 'user-a', fcmToken: 'token-2' },
    ]);
    sendMock
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('temporary send failure'));

    const summary = await service.sendAppNotificationToUsers(
      ['user-a'],
      payload,
    );

    expect(summary.deviceSendsSucceeded).toBe(1);
    expect(summary.deviceSendsFailed).toBe(1);
  });

  it('resolves safely on complete Firebase failure', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
    ]);
    sendMock.mockRejectedValue(new Error('send failed'));

    const summary = await service.sendAppNotificationToUsers(
      ['user-a'],
      payload,
    );

    expect(summary.deviceSendsSucceeded).toBe(0);
    expect(summary.deviceSendsFailed).toBe(1);
  });

  it('respects the configured broadcast concurrency limit', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'PUSH_NOTIFICATIONS_ENABLED') {
        return true;
      }
      if (key === 'PUSH_BROADCAST_CONCURRENCY') {
        return 2;
      }
      return undefined;
    });
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-1',
      'user-2',
      'user-3',
      'user-4',
      'user-5',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue(
      ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'].map((userId) => ({
        id: `device-${userId}`,
        userId,
        fcmToken: `token-${userId}`,
      })),
    );

    let active = 0;
    let maxActive = 0;
    sendMock.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return 'ok';
    });

    const summary = await service.sendAppNotificationToUsers(
      ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      payload,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(summary.configuredConcurrency).toBe(2);
  });

  it('falls back safely when concurrency config is invalid and clamps extremes', async () => {
    const cases: Array<[unknown, number]> = [
      [undefined, 15],
      ['abc', 15],
      [0, 1],
      [200, 50],
    ];

    for (const [rawValue, expected] of cases) {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PUSH_NOTIFICATIONS_ENABLED') {
          return true;
        }
        if (key === 'PUSH_BROADCAST_CONCURRENCY') {
          return rawValue;
        }
        return undefined;
      });
      pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
      pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
        reservedUserIds: [],
        skippedDuplicates: 1,
      });

      const summary = await service.sendAppNotificationToUsers(
        ['user-a'],
        payload,
      );
      expect(summary.configuredConcurrency).toBe(expected);
    }
  });

  it('uses normalized entityId in the summary and separates user/device metrics', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue([
      'user-a',
      'user-b',
    ]);
    pushDeliveryGuard.reserveDeliveries.mockResolvedValue({
      reservedUserIds: ['user-a', 'user-b'],
      skippedDuplicates: 0,
    });
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', userId: 'user-a', fcmToken: 'token-1' },
      { id: 'device-2', userId: 'user-a', fcmToken: 'token-2' },
    ]);
    sendMock
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('failed'));

    const summary = await service.sendAppNotificationToUsers(
      ['user-a', 'user-b'],
      {
        ...payload,
        entityId: '  trimmed-id  ',
      },
    );

    expect(summary.entityId).toBe('trimmed-id');
    expect(summary.requestedUsers).toBe(2);
    expect(summary.reservedUsers).toBe(2);
    expect(summary.usersWithDevices).toBe(1);
    expect(summary.usersWithoutDevices).toBe(1);
    expect(summary.deviceCount).toBe(2);
    expect(summary.deviceSendsSucceeded).toBe(1);
    expect(summary.deviceSendsFailed).toBe(1);
  });

  it('keeps the single-user path unchanged', async () => {
    pushDeliveryGuard.filterUsersForPush.mockResolvedValue(['user-a']);
    pushDeliveryGuard.recordSuccessfulPush.mockResolvedValue(undefined);
    const sendToUserSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue({
      userId: 'user-a',
      sentCount: 1,
      failedCount: 0,
    });

    const result = await service.sendAppNotificationToUser('user-a', payload);

    expect(sendToUserSpy).toHaveBeenCalledTimes(1);
    expect(pushDeliveryGuard.reserveDeliveries).not.toHaveBeenCalled();
    expect(pushDeliveryGuard.recordSuccessfulPush).toHaveBeenCalledWith(
      'user-a',
      payload,
    );
    expect(result).toEqual({
      userId: 'user-a',
      sentCount: 1,
      failedCount: 0,
    });
  });
});
