import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  function createService() {
    const upsert = jest.fn();
    const updateMany = jest.fn();
    const findMany = jest.fn().mockResolvedValue([]);
    const update = jest.fn();

    const prisma = {
      pushDevice: {
        upsert,
        updateMany,
        findMany,
        update,
      },
    };

    const service = new NotificationsService(prisma as never, {} as never);

    return {
      service,
      prisma,
      upsert,
      updateMany,
      findMany,
      update,
    };
  }

  it('register token creates or refreshes a PushDevice', async () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const { service, upsert } = createService();
    upsert.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      fcmToken: 'token-1',
      platform: 'android',
      enabled: true,
      lastSeenAt: now,
    });

    const result = await service.registerDevice('user-1', {
      token: 'token-1',
      platform: 'android',
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { fcmToken: 'token-1' },
      create: {
        userId: 'user-1',
        fcmToken: 'token-1',
        platform: 'android',
        enabled: true,
        lastSeenAt: now,
      },
      update: {
        userId: 'user-1',
        platform: 'android',
        enabled: true,
        lastSeenAt: now,
      },
    });
    expect(result).toEqual({
      id: 'device-1',
      token: 'token-1',
      platform: 'android',
      enabled: true,
      lastSeenAt: now,
    });
    jest.useRealTimers();
  });

  it('same token updates lastSeenAt without duplicates', async () => {
    const before = new Date('2026-06-20T10:00:00.000Z');
    const after = new Date('2026-06-20T10:05:00.000Z');
    jest.useFakeTimers().setSystemTime(after);
    const { service, upsert } = createService();
    upsert.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      fcmToken: 'token-1',
      platform: 'android',
      enabled: true,
      lastSeenAt: after,
    });

    await service.registerDevice('user-1', {
      token: 'token-1',
      platform: 'android',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastSeenAt: after,
        }),
      }),
    );
    expect(upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastSeenAt: before,
        }),
      }),
    );
    jest.useRealTimers();
  });

  it('token can move to current user on later login', async () => {
    const now = new Date('2026-06-20T10:10:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const { service, upsert } = createService();
    upsert.mockResolvedValue({
      id: 'device-1',
      userId: 'user-2',
      fcmToken: 'token-1',
      platform: 'android',
      enabled: true,
      lastSeenAt: now,
    });

    await service.registerDevice('user-2', {
      token: 'token-1',
      platform: 'android',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          userId: 'user-2',
        }),
      }),
    );
    jest.useRealTimers();
  });

  it('unregister disables only current user token', async () => {
    const now = new Date('2026-06-20T10:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const { service, updateMany } = createService();
    updateMany.mockResolvedValue({ count: 1 });

    const result = await service.unregisterDevice('user-1', 'token-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        fcmToken: 'token-1',
      },
      data: {
        enabled: false,
        lastSeenAt: now,
      },
    });
    expect(result).toEqual({
      token: 'token-1',
      disabled: true,
      lastSeenAt: now,
    });
    jest.useRealTimers();
  });
});
