import { PushDeliveryGuardService } from './push-delivery-guard.service';

describe('PushDeliveryGuardService', () => {
  function createService() {
    const findMany = jest.fn();
    const groupBy = jest.fn();
    const create = jest.fn();

    const prisma = {
      pushDeliveryLog: {
        findMany,
        groupBy,
        create,
      },
    };

    const service = new PushDeliveryGuardService(prisma as never);

    return { service, findMany, groupBy, create };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters users who already received the same push', async () => {
    const { service, findMany, groupBy } = createService();
    findMany.mockResolvedValue([{ userId: 'user-1' }]);
    groupBy.mockResolvedValue([]);

    const eligible = await service.filterUsersForPush(
      ['user-1', 'user-2'],
      {
        category: 'REGISTRATION_OPEN',
        title: 'Open',
        body: 'Join now',
        entityId: 'session-1',
      },
    );

    expect(eligible).toEqual(['user-2']);
  });

  it('rate-limits non-exempt categories after the global cap', async () => {
    const { service, findMany, groupBy } = createService();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([
      { userId: 'user-1', _count: { _all: 5 } },
      { userId: 'user-2', _count: { _all: 2 } },
    ]);

    const eligible = await service.filterUsersForPush(
      ['user-1', 'user-2'],
      {
        category: 'GAME_STARTED',
        title: 'Started',
        body: 'Live now',
        entityId: 'session-9',
      },
    );

    expect(eligible).toEqual(['user-2']);
  });

  it('applies a tighter marketing cap for broadcast categories', async () => {
    const { service, findMany, groupBy } = createService();
    findMany.mockResolvedValue([]);
    groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 'user-1', _count: { _all: 2 } }]);

    const eligible = await service.filterUsersForPush(
      ['user-1'],
      {
        category: 'BIG_GAME_TODAY',
        title: 'Today',
        body: 'Big game today',
        entityId: 'session-big',
      },
    );

    expect(eligible).toEqual([]);
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it('never rate-limits wallet and winner categories', async () => {
    const { service, findMany } = createService();
    findMany.mockResolvedValue([]);

    const eligible = await service.filterUsersForPush(['user-1'], {
      category: 'WINNER_ANNOUNCEMENT',
      title: 'Winner',
      body: 'You won',
      entityId: 'session-1',
    });

    expect(eligible).toEqual(['user-1']);
  });

  it('records successful deliveries for dedupe', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({ id: 'log-1' });

    await service.recordSuccessfulPush('user-1', {
      category: 'GAME_FINISHED',
      title: 'Finished',
      body: 'Done',
      entityId: 'session-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        category: 'GAME_FINISHED',
        entityId: 'session-1',
        sentAt: expect.any(Date),
      },
    });
  });
});
