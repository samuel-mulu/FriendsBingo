import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ADMIN_USER_FEATURE_GRANT_ACTION,
  USER_FEATURE_SETTINGS_EVENT,
  UsersService,
} from './users.service';

describe('UsersService.updateAdminUserFeatureGrants', () => {
  const userId = 'player-1';
  const actorId = 'admin-1';

  function buildRow(
    overrides: Partial<{
      autoMarkGranted: boolean;
      autoBingoGranted: boolean;
      autoMarkEnabled: boolean;
      autoBingoEnabled: boolean;
      featureSettingsVersion: number;
    }> = {},
  ) {
    return {
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
    findUnique?: jest.Mock;
    update?: jest.Mock;
    emitToUser?: jest.Mock;
    auditCreate?: jest.Mock;
  }) {
    const emitToUser = options?.emitToUser ?? jest.fn();
    const auditCreate = options?.auditCreate ?? jest.fn();
    const findUnique =
      options?.findUnique ?? jest.fn().mockResolvedValue(buildRow());
    const update = options?.update ?? jest.fn();
    const queryRaw = jest.fn().mockResolvedValue([{ id: userId }]);

    const prisma = {
      user: { findUnique, update },
      $queryRaw: queryRaw,
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: queryRaw,
          user: { findUnique, update },
        }),
      ),
    };

    const service = new UsersService(
      prisma as never,
      {} as never,
      { emitToUser } as never,
      { createWithDefaultClient: auditCreate } as never,
    );

    return { service, emitToUser, auditCreate, findUnique, update };
  }

  it('grants Auto Mark only and increments version once', async () => {
    const current = buildRow({ featureSettingsVersion: 1 });
    const updated = buildRow({
      autoMarkGranted: true,
      featureSettingsVersion: 2,
    });
    const update = jest.fn().mockResolvedValue(updated);
    const { service, emitToUser, auditCreate } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update,
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoMarkGranted: true },
      actorId,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoMarkGranted: true,
          autoBingoGranted: false,
          autoMarkEnabled: false,
          autoBingoEnabled: false,
          featureSettingsVersion: { increment: 1 },
        }),
      }),
    );
    expect(result.autoMarkGranted).toBe(true);
    expect(result.autoBingoGranted).toBe(false);
    expect(result.featureSettingsVersion).toBe(2);
    expect(emitToUser).toHaveBeenCalledWith(
      userId,
      USER_FEATURE_SETTINGS_EVENT,
      result,
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId,
        action: ADMIN_USER_FEATURE_GRANT_ACTION,
        entity: 'User',
        entityId: userId,
        metadata: expect.objectContaining({
          changedFields: expect.arrayContaining(['autoMarkGranted']),
        }),
      }),
    );
  });

  it('grants Auto Bingo only', async () => {
    const update = jest.fn().mockResolvedValue(
      buildRow({
        autoBingoGranted: true,
        featureSettingsVersion: 1,
      }),
    );
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(buildRow()),
      update,
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoBingoGranted: true },
      actorId,
    );

    expect(result.autoBingoGranted).toBe(true);
    expect(result.autoMarkGranted).toBe(false);
  });

  it('grants both atomically', async () => {
    const update = jest.fn().mockResolvedValue(
      buildRow({
        autoMarkGranted: true,
        autoBingoGranted: true,
        featureSettingsVersion: 1,
      }),
    );
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(buildRow()),
      update,
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoMarkGranted: true, autoBingoGranted: true },
      actorId,
    );

    expect(result.autoMarkGranted).toBe(true);
    expect(result.autoBingoGranted).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('revocation resets matching enabled preference', async () => {
    const current = buildRow({
      autoMarkGranted: true,
      autoMarkEnabled: true,
      autoBingoGranted: true,
      autoBingoEnabled: true,
      featureSettingsVersion: 4,
    });
    const updated = buildRow({
      autoMarkGranted: false,
      autoMarkEnabled: false,
      autoBingoGranted: true,
      autoBingoEnabled: true,
      featureSettingsVersion: 5,
    });
    const update = jest.fn().mockResolvedValue(updated);
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update,
    });

    await service.updateAdminUserFeatureGrants(
      userId,
      { autoMarkGranted: false },
      actorId,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoMarkGranted: false,
          autoMarkEnabled: false,
          autoBingoGranted: true,
          autoBingoEnabled: true,
        }),
      }),
    );
  });

  it('re-grant leaves enabled OFF', async () => {
    const current = buildRow({
      autoMarkGranted: false,
      autoMarkEnabled: false,
      featureSettingsVersion: 2,
    });
    const updated = buildRow({
      autoMarkGranted: true,
      autoMarkEnabled: false,
      featureSettingsVersion: 3,
    });
    const update = jest.fn().mockResolvedValue(updated);
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update,
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoMarkGranted: true },
      actorId,
    );

    expect(result.autoMarkGranted).toBe(true);
    expect(result.autoMarkEnabled).toBe(false);
    expect(result.effectiveAutoMark).toBe(false);
  });

  it('no-op does not increment version, emit, or audit', async () => {
    const current = buildRow({
      autoMarkGranted: true,
      featureSettingsVersion: 9,
    });
    const { service, emitToUser, auditCreate, update } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoMarkGranted: true },
      actorId,
    );

    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(result.featureSettingsVersion).toBe(9);
  });

  it('rejects empty payload', async () => {
    const { service, emitToUser } = createService();

    await expect(
      service.updateAdminUserFeatureGrants(userId, {}, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('rejects missing user without emit', async () => {
    const { service, emitToUser, auditCreate } = createService({
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.updateAdminUserFeatureGrants(
        userId,
        { autoMarkGranted: true },
        actorId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(emitToUser).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('concurrent revoke wins over player enable via row lock snapshot', async () => {
    // After FOR UPDATE, grant is already false; admin revoke is no-op on grant
    // but clears enabled if still true from a racing preference.
    const current = buildRow({
      autoBingoGranted: false,
      autoBingoEnabled: true,
      featureSettingsVersion: 6,
    });
    const updated = buildRow({
      autoBingoGranted: false,
      autoBingoEnabled: false,
      featureSettingsVersion: 7,
    });
    const update = jest.fn().mockResolvedValue(updated);
    const { service, emitToUser } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update,
    });

    const result = await service.updateAdminUserFeatureGrants(
      userId,
      { autoBingoGranted: false },
      actorId,
    );

    expect(result.autoBingoEnabled).toBe(false);
    expect(result.effectiveAutoBingo).toBe(false);
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });
});
