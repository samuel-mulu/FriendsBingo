import { PushDeliveryGuardService } from './push-delivery-guard.service';
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
});
