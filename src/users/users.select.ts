import { Prisma } from '@prisma/client';
import { walletSelect } from '../wallet/wallet.select';

/** Shared identity/profile fields. Intentionally excludes Auto Mark/Bingo flags so nested deposit/withdrawal user payloads stay unchanged. */
export const userProfileSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  fullName: true,
  phoneNumber: true,
  role: true,
  status: true,
  gamePushMode: true,
  blockReason: true,
  blockedAt: true,
  password: true,
  telegramId: true,
  telegramUsername: true,
  createdAt: true,
  updatedAt: true,
});

/** Admin-granted permissions + player preferences for Auto Mark / Auto Bingo. */
export const userFeatureSettingsSelect =
  Prisma.validator<Prisma.UserSelect>()({
    autoMarkGranted: true,
    autoBingoGranted: true,
    autoMarkEnabled: true,
    autoBingoEnabled: true,
    featureSettingsVersion: true,
  });

/** Dedicated GET/PATCH /users/me/feature-settings response select. */
export const userFeatureSettingsResponseSelect =
  Prisma.validator<Prisma.UserSelect>()({
    ...userFeatureSettingsSelect,
    updatedAt: true,
  });

/** Bulk admin grant processing select (includes id for lock/update loops). */
export const userFeatureSettingsLockedSelect =
  Prisma.validator<Prisma.UserSelect>()({
    id: true,
    ...userFeatureSettingsResponseSelect,
  });

/** Player-facing profile responses (auth, /users/me) that include feature settings. */
export const userProfileWithFeatureSettingsSelect =
  Prisma.validator<Prisma.UserSelect>()({
    ...userProfileSelect,
    ...userFeatureSettingsSelect,
  });

export const userProfileWithWalletSelect =
  Prisma.validator<Prisma.UserSelect>()({
    ...userProfileWithFeatureSettingsSelect,
    wallet: {
      select: walletSelect,
    },
  });

export const adminUserListSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  fullName: true,
  phoneNumber: true,
  role: true,
  status: true,
  blockReason: true,
  blockedAt: true,
  createdAt: true,
  ...userFeatureSettingsSelect,
  wallet: {
    select: {
      balance: true,
    },
  },
});

export const adminUserDetailSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  fullName: true,
  phoneNumber: true,
  role: true,
  status: true,
  blockReason: true,
  blockedAt: true,
  blockedById: true,
  createdAt: true,
  updatedAt: true,
  ...userFeatureSettingsSelect,
  wallet: {
    select: walletSelect,
  },
  _count: {
    select: {
      deposits: true,
      withdrawals: true,
      gameCartelas: true,
      transactions: true,
    },
  },
});

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof userProfileSelect;
}>;

export type UserFeatureSettingsRecord = Prisma.UserGetPayload<{
  select: typeof userFeatureSettingsResponseSelect;
}>;

export type UserFeatureSettingsLockedRecord = Prisma.UserGetPayload<{
  select: typeof userFeatureSettingsLockedSelect;
}>;

export type UserProfileWithFeatureSettings = Prisma.UserGetPayload<{
  select: typeof userProfileWithFeatureSettingsSelect;
}>;

export type UserProfileWithWallet = Prisma.UserGetPayload<{
  select: typeof userProfileWithWalletSelect;
}>;

export type AdminUserListRecord = Prisma.UserGetPayload<{
  select: typeof adminUserListSelect;
}>;

export type AdminUserDetailRecord = Prisma.UserGetPayload<{
  select: typeof adminUserDetailSelect;
}>;
