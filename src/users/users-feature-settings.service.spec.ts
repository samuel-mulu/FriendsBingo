import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  FEATURE_NOT_GRANTED_CODE,
  USER_FEATURE_SETTINGS_EVENT,
  UsersService,
} from './users.service';

describe('UsersService feature settings', () => {
  const userId = 'user-1';

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
    queryRaw?: jest.Mock;
    emitToUser?: jest.Mock;
  }) {
    const emitToUser = options?.emitToUser ?? jest.fn();
    const queryRaw = options?.queryRaw ?? jest.fn().mockResolvedValue([{ id: userId }]);
    const findUnique =
      options?.findUnique ?? jest.fn().mockResolvedValue(buildRow());
    const update = options?.update ?? jest.fn();

    const prisma = {
      user: {
        findUnique,
        update,
      },
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
      {} as never,
    );

    return { service, prisma, emitToUser, findUnique, update, queryRaw };
  }

  it('GET returns grants, prefs, effective flags and version', async () => {
    const row = buildRow({
      autoMarkGranted: true,
      autoMarkEnabled: true,
      featureSettingsVersion: 3,
    });
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(row),
    });

    await expect(service.getFeatureSettings(userId)).resolves.toEqual({
      autoMarkGranted: true,
      autoBingoGranted: false,
      autoMarkEnabled: true,
      autoBingoEnabled: false,
      effectiveAutoMark: true,
      effectiveAutoBingo: false,
      featureSettingsVersion: 3,
      updatedAt: row.updatedAt,
    });
  });

  it('PATCH enables a granted feature, increments version, and emits', async () => {
    const current = buildRow({
      autoMarkGranted: true,
      featureSettingsVersion: 1,
    });
    const updated = buildRow({
      autoMarkGranted: true,
      autoMarkEnabled: true,
      featureSettingsVersion: 2,
    });
    const findUnique = jest.fn().mockResolvedValue(current);
    const update = jest.fn().mockResolvedValue(updated);
    const { service, emitToUser } = createService({ findUnique, update });

    const result = await service.updateFeatureSettings(userId, {
      autoMarkEnabled: true,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: expect.objectContaining({
          autoMarkEnabled: true,
          autoBingoEnabled: false,
          featureSettingsVersion: { increment: 1 },
        }),
      }),
    );
    expect(result.featureSettingsVersion).toBe(2);
    expect(result.effectiveAutoMark).toBe(true);
    expect(emitToUser).toHaveBeenCalledWith(
      userId,
      USER_FEATURE_SETTINGS_EVENT,
      result,
    );
  });

  it('PATCH disables without grant requirement and emits', async () => {
    const current = buildRow({
      autoMarkGranted: false,
      autoMarkEnabled: true,
      featureSettingsVersion: 4,
    });
    const updated = buildRow({
      autoMarkGranted: false,
      autoMarkEnabled: false,
      featureSettingsVersion: 5,
    });
    const { service, emitToUser, update } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(updated),
    });

    const result = await service.updateFeatureSettings(userId, {
      autoMarkEnabled: false,
    });

    expect(update).toHaveBeenCalled();
    expect(result.autoMarkEnabled).toBe(false);
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it('rejects enable when not granted and does not emit', async () => {
    const { service, emitToUser, update } = createService({
      findUnique: jest.fn().mockResolvedValue(
        buildRow({ autoMarkGranted: false, autoMarkEnabled: false }),
      ),
    });

    await expect(
      service.updateFeatureSettings(userId, { autoMarkEnabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    try {
      await service.updateFeatureSettings(userId, { autoMarkEnabled: true });
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: FEATURE_NOT_GRANTED_CODE }),
      );
    }

    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('preserves omitted preference fields', async () => {
    const current = buildRow({
      autoMarkGranted: true,
      autoBingoGranted: true,
      autoMarkEnabled: true,
      autoBingoEnabled: false,
      featureSettingsVersion: 2,
    });
    const updated = buildRow({
      autoMarkGranted: true,
      autoBingoGranted: true,
      autoMarkEnabled: true,
      autoBingoEnabled: true,
      featureSettingsVersion: 3,
    });
    const update = jest.fn().mockResolvedValue(updated);
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
      update,
    });

    await service.updateFeatureSettings(userId, { autoBingoEnabled: true });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoMarkEnabled: true,
          autoBingoEnabled: true,
        }),
      }),
    );
  });

  it('rejects concurrent revoke versus player enable and does not emit', async () => {
    // Locked row already shows grant revoked before enable write.
    const { service, emitToUser, update } = createService({
      findUnique: jest.fn().mockResolvedValue(
        buildRow({
          autoBingoGranted: false,
          autoBingoEnabled: false,
          featureSettingsVersion: 9,
        }),
      ),
    });

    await expect(
      service.updateFeatureSettings(userId, { autoBingoEnabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('no-op PATCH does not increment version or emit', async () => {
    const current = buildRow({
      autoMarkGranted: true,
      autoMarkEnabled: true,
      featureSettingsVersion: 7,
    });
    const { service, emitToUser, update } = createService({
      findUnique: jest.fn().mockResolvedValue(current),
    });

    const result = await service.updateFeatureSettings(userId, {
      autoMarkEnabled: true,
    });

    expect(update).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(result.featureSettingsVersion).toBe(7);
  });

  it('GET missing user throws NotFound and update missing user does not emit', async () => {
    const emitToUser = jest.fn();
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue(null),
      emitToUser,
    });

    await expect(service.getFeatureSettings(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.updateFeatureSettings(userId, { autoMarkEnabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(emitToUser).not.toHaveBeenCalled();
  });
});
