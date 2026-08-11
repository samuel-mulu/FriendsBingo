import { PushDeliveryGuardService } from './push-delivery-guard.service';
import { PUSH_MARKETING_CATEGORIES } from './push-rate-policy';
import type { AppPushNotificationPayload } from './types/push-category.type';

describe('PushDeliveryGuardService', () => {
  const payload: AppPushNotificationPayload = {
    category: 'REGISTRATION_OPEN',
    title: 'Open',
    body: 'Body',
    entityId: ' session-1 ',
  };

  let prisma: {
    $queryRaw: jest.Mock;
    pushDeliveryLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let service: PushDeliveryGuardService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      pushDeliveryLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    service = new PushDeliveryGuardService(prisma as never);
  });

  it('reserves deliveries with one bulk raw query for large broadcasts', async () => {
    const userIds = Array.from({ length: 264 }, (_, index) => `user-${index}`);
    prisma.$queryRaw.mockResolvedValue(
      userIds.map((userId) => ({
        userId,
      })),
    );

    const result = await service.reserveDeliveries(
      userIds,
      payload,
      new Date('2026-07-24T10:00:00.000Z'),
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.pushDeliveryLog.create).not.toHaveBeenCalled();
    expect(result.reservedUserIds).toEqual(userIds);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('returns early for empty reservation input', async () => {
    await expect(service.reserveDeliveries([], payload)).resolves.toEqual({
      reservedUserIds: [],
      skippedDuplicates: 0,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deduplicates input ids before building the reservation query', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);

    const result = await service.reserveDeliveries(
      ['user-1', 'user-1', '', 'user-2'],
      payload,
      new Date('2026-07-24T10:00:00.000Z'),
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [query] = prisma.$queryRaw.mock.calls[0] as [{ values: unknown[] }];
    expect(query.values.filter((value) => value === 'user-1')).toHaveLength(1);
    expect(query.values.filter((value) => value === 'user-2')).toHaveLength(1);
    expect(result).toEqual({
      reservedUserIds: ['user-1', 'user-2'],
      skippedDuplicates: 0,
    });
  });

  it('returns empty reserved users when all users were already reserved', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.reserveDeliveries(['user-1', 'user-2'], payload),
    ).resolves.toEqual({
      reservedUserIds: [],
      skippedDuplicates: 2,
    });
  });

  it('normalizes entityId exactly like the current helper', async () => {
    prisma.$queryRaw.mockResolvedValue([{ userId: 'user-1' }]);

    await service.reserveDeliveries(
      ['user-1'],
      {
        ...payload,
        entityId: '  same-id  ',
      },
      new Date('2026-07-24T10:00:00.000Z'),
    );
    await service.reserveDeliveries(
      ['user-1'],
      {
        ...payload,
        entityId: undefined,
      },
      new Date('2026-07-24T10:00:00.000Z'),
    );

    const firstQueryValues = (
      prisma.$queryRaw.mock.calls[0] as [{ values: unknown[] }]
    )[0].values;
    const secondQueryValues = (
      prisma.$queryRaw.mock.calls[1] as [{ values: unknown[] }]
    )[0].values;

    expect(firstQueryValues).toContain('same-id');
    expect(secondQueryValues).toContain('');
  });

  describe('filterUsersForPush', () => {
    const now = new Date('2026-08-11T10:00:00.000Z');

    function registrationPayload(
      entityId: string,
    ): AppPushNotificationPayload {
      return {
        category: 'REGISTRATION_OPEN',
        title: 'Open',
        body: 'Body',
        entityId,
      };
    }

    function bigGamePayload(entityId: string): AppPushNotificationPayload {
      return {
        category: 'BIG_GAME_REGISTRATION_OPEN',
        title: 'Big open',
        body: 'Body',
        entityId,
      };
    }

    function mockGroupByCount(count: number) {
      prisma.pushDeliveryLog.groupBy.mockResolvedValueOnce(
        count > 0
          ? [{ userId: 'user-1', _count: { _all: count } }]
          : [],
      );
    }

    it('allows two different REGISTRATION_OPEN entityIds within 30 minutes', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(1);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          registrationPayload('session-2'),
          now,
        ),
      ).resolves.toEqual(['user-1']);

      expect(prisma.pushDeliveryLog.groupBy).toHaveBeenCalledTimes(1);
      expect(
        prisma.pushDeliveryLog.groupBy.mock.calls[0][0].where.category,
      ).toBeUndefined();
    });

    it('does not block a third different REGISTRATION_OPEN entityId with the marketing cap', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(2);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          registrationPayload('session-3'),
          now,
        ),
      ).resolves.toEqual(['user-1']);

      expect(prisma.pushDeliveryLog.groupBy).toHaveBeenCalledTimes(1);
    });

    it('still dedupes the same REGISTRATION_OPEN entityId', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([
        { userId: 'user-1' },
      ]);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          registrationPayload('session-1'),
          now,
        ),
      ).resolves.toEqual([]);

      expect(prisma.pushDeliveryLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: { in: ['user-1'] },
          category: 'REGISTRATION_OPEN',
          entityId: 'session-1',
        },
        select: { userId: true },
      });
      expect(prisma.pushDeliveryLog.groupBy).not.toHaveBeenCalled();
    });

    it('still limits BIG_GAME_REGISTRATION_OPEN by the marketing policy', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(2);
      mockGroupByCount(2);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          bigGamePayload('big-session-3'),
          now,
        ),
      ).resolves.toEqual([]);

      expect(prisma.pushDeliveryLog.groupBy).toHaveBeenCalledTimes(2);
      const marketingWhere =
        prisma.pushDeliveryLog.groupBy.mock.calls[1][0].where;
      expect(marketingWhere.category.in).toEqual(
        expect.arrayContaining([...PUSH_MARKETING_CATEGORIES]),
      );
      expect(marketingWhere.category.in).not.toContain('REGISTRATION_OPEN');
    });

    it('does not let prior REGISTRATION_OPEN deliveries consume the big-game marketing cap', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(2);
      mockGroupByCount(0);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          bigGamePayload('big-session-1'),
          now,
        ),
      ).resolves.toEqual(['user-1']);
    });

    it('still blocks REGISTRATION_OPEN at the global 5-per-15-minute cap', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(5);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          registrationPayload('session-6'),
          now,
        ),
      ).resolves.toEqual([]);

      expect(prisma.pushDeliveryLog.groupBy).toHaveBeenCalledTimes(1);
    });

    it('still allows REGISTRATION_OPEN under the global cap', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);
      mockGroupByCount(4);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          registrationPayload('session-5'),
          now,
        ),
      ).resolves.toEqual(['user-1']);
    });

    it('keeps winner and deposit pushes exempt from rate limits', async () => {
      prisma.pushDeliveryLog.findMany.mockResolvedValue([]);

      await expect(
        service.filterUsersForPush(
          ['user-1'],
          {
            category: 'WINNER_ANNOUNCEMENT',
            title: 'Winner',
            body: 'Body',
            entityId: 'session-1',
          },
          now,
        ),
      ).resolves.toEqual(['user-1']);
      await expect(
        service.filterUsersForPush(
          ['user-1'],
          {
            category: 'DEPOSIT_APPROVED',
            title: 'Deposit',
            body: 'Body',
            entityId: 'deposit-1',
          },
          now,
        ),
      ).resolves.toEqual(['user-1']);

      expect(prisma.pushDeliveryLog.groupBy).not.toHaveBeenCalled();
    });
  });
});
