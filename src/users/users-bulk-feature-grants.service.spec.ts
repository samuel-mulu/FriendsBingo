import { BadRequestException } from '@nestjs/common';
import {
  ADMIN_USER_FEATURE_GRANT_BULK_ACTION,
  USER_FEATURE_SETTINGS_EVENT,
  UsersService,
} from './users.service';

describe('UsersService.bulkUpdateAdminUserFeatureGrants', () => {
  const actorId = 'admin-1';

  function buildRow(
    id: string,
    overrides: Partial<{
      autoMarkGranted: boolean;
      autoBingoGranted: boolean;
      autoMarkEnabled: boolean;
      autoBingoEnabled: boolean;
      featureSettingsVersion: number;
    }> = {},
  ) {
    return {
      id,
      autoMarkGranted: false,
      autoBingoGranted: false,
      autoMarkEnabled: false,
      autoBingoEnabled: false,
      featureSettingsVersion: 0,
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
      ...overrides,
    };
  }

  function createService(options?: {
    findMany?: jest.Mock;
    findUnique?: jest.Mock;
    update?: jest.Mock;
    queryRaw?: jest.Mock;
    emitToUser?: jest.Mock;
    auditCreate?: jest.Mock;
    auditFindFirst?: jest.Mock;
  }) {
    const emitToUser = options?.emitToUser ?? jest.fn();
    const auditCreate = options?.auditCreate ?? jest.fn();
    const auditFindFirst = options?.auditFindFirst ?? jest.fn().mockResolvedValue(null);
    const findMany = options?.findMany ?? jest.fn().mockResolvedValue([]);
    const findUnique = options?.findUnique ?? jest.fn();
    const update = options?.update ?? jest.fn();
    const queryRaw = options?.queryRaw ?? jest.fn().mockResolvedValue([]);

    const tx = {
      $queryRaw: queryRaw,
      user: { findMany, findUnique, update },
    };

    const prisma = {
      user: { findMany, findUnique, update },
      auditLog: { findFirst: auditFindFirst },
      $queryRaw: queryRaw,
      $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const service = new UsersService(
      prisma as never,
      {} as never,
      { emitToUser } as never,
      { createWithDefaultClient: auditCreate } as never,
    );

    return {
      service,
      emitToUser,
      auditCreate,
      auditFindFirst,
      findMany,
      update,
      prisma,
    };
  }

  it('rejects empty targeting / both modes / empty patch', async () => {
    const { service } = createService();

    await expect(
      service.bulkUpdateAdminUserFeatureGrants(
        { patch: { autoMarkGranted: true } } as never,
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.bulkUpdateAdminUserFeatureGrants(
        {
          userIds: ['11111111-1111-4111-8111-111111111111'],
          filter: { role: 'PLAYER' as never },
          patch: { autoMarkGranted: true },
          operationId: '22222222-2222-4222-8222-222222222222',
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.bulkUpdateAdminUserFeatureGrants(
        {
          userIds: ['11111111-1111-4111-8111-111111111111'],
          patch: {},
          operationId: '22222222-2222-4222-8222-222222222222',
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dryRun preview returns matched count without mutate/emit/audit', async () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ];
    const { service, emitToUser, auditCreate, update } = createService({
      findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    });

    const result = await service.bulkUpdateAdminUserFeatureGrants(
      {
        filter: { role: 'PLAYER' as never, search: 'abe' },
        patch: { autoMarkGranted: true },
        dryRun: true,
      },
      actorId,
    );

    expect(result).toMatchObject({
      dryRun: true,
      targetingMode: 'filter',
      matched: 2,
      changed: 0,
      unchanged: 0,
      failed: 0,
    });
    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('explicit IDs dedupe and grant Mark only', async () => {
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const rows = [
      buildRow(idA),
      buildRow(idB, { autoBingoGranted: true, autoBingoEnabled: true }),
    ];

    const findMany = jest
      .fn()
      // resolve targets
      .mockResolvedValueOnce([{ id: idA }, { id: idB }])
      // locked chunk read
      .mockResolvedValueOnce(rows);

    const update = jest
      .fn()
      .mockResolvedValueOnce(
        buildRow(idA, { autoMarkGranted: true, featureSettingsVersion: 1 }),
      )
      .mockResolvedValueOnce(
        buildRow(idB, {
          autoMarkGranted: true,
          autoBingoGranted: true,
          autoBingoEnabled: true,
          featureSettingsVersion: 1,
        }),
      );

    const { service, emitToUser, auditCreate } = createService({
      findMany,
      update,
    });

    const result = await service.bulkUpdateAdminUserFeatureGrants(
      {
        userIds: [idA, idA, idB],
        patch: { autoMarkGranted: true },
        operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      actorId,
    );

    expect(result.matched).toBe(2);
    expect(result.changed).toBe(2);
    expect(result.unchanged).toBe(0);
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(emitToUser).toHaveBeenCalledWith(
      idA,
      USER_FEATURE_SETTINGS_EVENT,
      expect.objectContaining({ autoMarkGranted: true }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_USER_FEATURE_GRANT_BULK_ACTION,
        entityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        metadata: expect.objectContaining({
          phase: 'completed',
          changed: 2,
        }),
      }),
    );
  });

  it('noop rows do not emit or increment; revoke clears enabled', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id }])
      .mockResolvedValueOnce([
        buildRow(id, {
          autoMarkGranted: true,
          autoMarkEnabled: true,
          featureSettingsVersion: 4,
        }),
      ]);
    const update = jest.fn().mockResolvedValue(
      buildRow(id, {
        autoMarkGranted: false,
        autoMarkEnabled: false,
        featureSettingsVersion: 5,
      }),
    );
    const { service, emitToUser } = createService({ findMany, update });

    const result = await service.bulkUpdateAdminUserFeatureGrants(
      {
        userIds: [id],
        patch: { autoMarkGranted: false },
        operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
      actorId,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoMarkGranted: false,
          autoMarkEnabled: false,
          featureSettingsVersion: { increment: 1 },
        }),
      }),
    );
    expect(result.changed).toBe(1);
    expect(emitToUser).toHaveBeenCalledTimes(1);

    // second call: already revoked => unchanged
    findMany
      .mockResolvedValueOnce([{ id }])
      .mockResolvedValueOnce([
        buildRow(id, {
          autoMarkGranted: false,
          autoMarkEnabled: false,
          featureSettingsVersion: 5,
        }),
      ]);
    update.mockClear();
    emitToUser.mockClear();

    const noop = await service.bulkUpdateAdminUserFeatureGrants(
      {
        userIds: [id],
        patch: { autoMarkGranted: false },
        operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      },
      actorId,
    );

    expect(noop.changed).toBe(0);
    expect(noop.unchanged).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('idempotent replay returns prior result without re-apply', async () => {
    const operationId = '99999999-9999-4999-8999-999999999999';
    const { service, emitToUser, update, findMany } = createService({
      auditFindFirst: jest.fn().mockResolvedValue({
        metadata: {
          phase: 'completed',
          targetingMode: 'ids',
          matched: 3,
          changed: 2,
          unchanged: 1,
          failed: 0,
          failureSummary: [],
        },
      }),
    });

    const result = await service.bulkUpdateAdminUserFeatureGrants(
      {
        userIds: ['11111111-1111-4111-8111-111111111111'],
        patch: { autoBingoGranted: true },
        operationId,
      },
      actorId,
    );

    expect(result).toMatchObject({
      operationId,
      matched: 3,
      changed: 2,
      unchanged: 1,
      failed: 0,
      idempotentReplay: true,
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('requires operationId for apply', async () => {
    const { service } = createService();
    await expect(
      service.bulkUpdateAdminUserFeatureGrants(
        {
          userIds: ['11111111-1111-4111-8111-111111111111'],
          patch: { autoMarkGranted: true },
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
