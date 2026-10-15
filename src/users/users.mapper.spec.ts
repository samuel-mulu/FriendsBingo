import { GamePushMode, UserRole, UserStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  serializeAdminUserDetail,
  serializeAdminUserListItem,
  serializeFeatureSettings,
  serializeUser,
} from './users.mapper';
import type {
  AdminUserDetailRecord,
  AdminUserListRecord,
  UserFeatureSettingsRecord,
  UserProfileWithFeatureSettings,
} from './users.select';

function buildProfile(
  overrides: Partial<UserProfileWithFeatureSettings> = {},
): UserProfileWithFeatureSettings {
  return {
    id: 'user-1',
    fullName: 'Test Player',
    phoneNumber: '0911223344',
    role: UserRole.PLAYER,
    status: UserStatus.ACTIVE,
    gamePushMode: GamePushMode.REGISTERED_ONLY,
    blockReason: null,
    blockedAt: null,
    password: 'hashed',
    telegramId: null,
    telegramUsername: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    autoMarkGranted: false,
    autoBingoGranted: false,
    autoMarkEnabled: false,
    autoBingoEnabled: false,
    featureSettingsVersion: 0,
    ...overrides,
  };
}

function buildFeatureSettings(
  overrides: Partial<UserFeatureSettingsRecord> = {},
): UserFeatureSettingsRecord {
  return {
    autoMarkGranted: false,
    autoBingoGranted: false,
    autoMarkEnabled: false,
    autoBingoEnabled: false,
    featureSettingsVersion: 0,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function buildAdminListItem(
  overrides: Partial<AdminUserListRecord> = {},
): AdminUserListRecord {
  return {
    id: 'user-1',
    fullName: 'Test Player',
    phoneNumber: '0911223344',
    role: UserRole.PLAYER,
    status: UserStatus.ACTIVE,
    blockReason: null,
    blockedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    autoMarkGranted: false,
    autoBingoGranted: false,
    autoMarkEnabled: false,
    autoBingoEnabled: false,
    featureSettingsVersion: 0,
    wallet: {
      balance: new Prisma.Decimal('12.50'),
    },
    ...overrides,
  };
}

function buildAdminDetail(
  overrides: Partial<AdminUserDetailRecord> = {},
): AdminUserDetailRecord {
  return {
    id: 'user-1',
    fullName: 'Test Player',
    phoneNumber: '0911223344',
    role: UserRole.PLAYER,
    status: UserStatus.ACTIVE,
    blockReason: null,
    blockedAt: null,
    blockedById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    autoMarkGranted: false,
    autoBingoGranted: false,
    autoMarkEnabled: false,
    autoBingoEnabled: false,
    featureSettingsVersion: 0,
    wallet: null,
    _count: {
      deposits: 1,
      withdrawals: 2,
      gameCartelas: 3,
      transactions: 4,
    },
    ...overrides,
  };
}

describe('users.mapper feature settings', () => {
  it('serializeUser defaults to false grants/prefs and effective flags', () => {
    const serialized = serializeUser(buildProfile());

    expect(serialized.autoMarkGranted).toBe(false);
    expect(serialized.autoBingoGranted).toBe(false);
    expect(serialized.autoMarkEnabled).toBe(false);
    expect(serialized.autoBingoEnabled).toBe(false);
    expect(serialized.effectiveAutoMark).toBe(false);
    expect(serialized.effectiveAutoBingo).toBe(false);
    expect(serialized.hasPassword).toBe(true);
    expect(serialized.telegramLinked).toBe(false);
    expect(serialized).not.toHaveProperty('password');
  });

  it('serializeUser maps inconsistent and independent combinations', () => {
    expect(
      serializeUser(
        buildProfile({
          autoMarkGranted: false,
          autoMarkEnabled: true,
          autoBingoGranted: true,
          autoBingoEnabled: false,
        }),
      ),
    ).toMatchObject({
      effectiveAutoMark: false,
      effectiveAutoBingo: false,
    });

    expect(
      serializeUser(
        buildProfile({
          autoMarkGranted: true,
          autoMarkEnabled: true,
          autoBingoGranted: false,
          autoBingoEnabled: true,
        }),
      ),
    ).toMatchObject({
      effectiveAutoMark: true,
      effectiveAutoBingo: false,
    });

    expect(
      serializeUser(
        buildProfile({
          autoMarkGranted: true,
          autoMarkEnabled: true,
          autoBingoGranted: true,
          autoBingoEnabled: true,
        }),
      ),
    ).toMatchObject({
      effectiveAutoMark: true,
      effectiveAutoBingo: true,
    });
  });

  it('serializeFeatureSettings includes version and effective flags', () => {
    expect(
      serializeFeatureSettings(
        buildFeatureSettings({
          autoMarkGranted: true,
          autoMarkEnabled: true,
          featureSettingsVersion: 4,
        }),
      ),
    ).toEqual({
      autoMarkGranted: true,
      autoBingoGranted: false,
      autoMarkEnabled: true,
      autoBingoEnabled: false,
      effectiveAutoMark: true,
      effectiveAutoBingo: false,
      featureSettingsVersion: 4,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it('serializeAdminUserListItem includes feature fields and walletBalance', () => {
    const serialized = serializeAdminUserListItem(
      buildAdminListItem({
        autoMarkGranted: true,
        autoMarkEnabled: false,
        autoBingoGranted: false,
        autoBingoEnabled: true,
      }),
    );

    expect(serialized).toMatchObject({
      autoMarkGranted: true,
      autoBingoGranted: false,
      autoMarkEnabled: false,
      autoBingoEnabled: true,
      effectiveAutoMark: false,
      effectiveAutoBingo: false,
      walletBalance: '12.5',
    });
  });

  it('serializeAdminUserDetail includes feature fields and counts', () => {
    const serialized = serializeAdminUserDetail(
      buildAdminDetail({
        autoMarkGranted: true,
        autoMarkEnabled: true,
        autoBingoGranted: true,
        autoBingoEnabled: false,
      }),
      7,
    );

    expect(serialized).toMatchObject({
      autoMarkGranted: true,
      autoBingoGranted: true,
      autoMarkEnabled: true,
      autoBingoEnabled: false,
      effectiveAutoMark: true,
      effectiveAutoBingo: false,
      counts: {
        deposits: 1,
        withdrawals: 2,
        gameCartelas: 3,
        transactions: 4,
        winnerCartelas: 7,
      },
    });
  });
});
