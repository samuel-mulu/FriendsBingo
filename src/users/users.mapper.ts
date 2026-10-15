import { serializeWallet } from '../wallet/wallet.mapper';
import { computeEffectiveFeatureSettings } from './user-feature-settings.util';
import {
  AdminUserDetailRecord,
  AdminUserListRecord,
  UserFeatureSettingsRecord,
  UserProfileWithFeatureSettings,
  UserProfileWithWallet,
} from './users.select';

function toPublicUserFields(user: UserProfileWithFeatureSettings) {
  const { password, blockReason, blockedAt, ...rest } = user;
  return {
    ...rest,
    ...computeEffectiveFeatureSettings(user),
    hasPassword: Boolean(password),
    telegramLinked: Boolean(user.telegramId),
  };
}

export function serializeUser(user: UserProfileWithFeatureSettings) {
  return toPublicUserFields(user);
}

export function serializeUserWithWallet(user: UserProfileWithWallet) {
  return {
    ...toPublicUserFields(user),
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
  };
}

export function serializeFeatureSettings(user: UserFeatureSettingsRecord) {
  return {
    autoMarkGranted: user.autoMarkGranted,
    autoBingoGranted: user.autoBingoGranted,
    autoMarkEnabled: user.autoMarkEnabled,
    autoBingoEnabled: user.autoBingoEnabled,
    ...computeEffectiveFeatureSettings(user),
    featureSettingsVersion: user.featureSettingsVersion,
    updatedAt: user.updatedAt,
  };
}

export function serializeAdminUserListItem(user: AdminUserListRecord) {
  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
    blockReason: user.blockReason,
    blockedAt: user.blockedAt,
    autoMarkGranted: user.autoMarkGranted,
    autoBingoGranted: user.autoBingoGranted,
    autoMarkEnabled: user.autoMarkEnabled,
    autoBingoEnabled: user.autoBingoEnabled,
    featureSettingsVersion: user.featureSettingsVersion,
    ...computeEffectiveFeatureSettings(user),
    walletBalance: user.wallet?.balance.toString() ?? '0',
    createdAt: user.createdAt,
  };
}

export function serializeAdminUserDetail(
  user: AdminUserDetailRecord,
  winnerCartelas = 0,
) {
  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
    blockReason: user.blockReason,
    blockedAt: user.blockedAt,
    blockedById: user.blockedById,
    autoMarkGranted: user.autoMarkGranted,
    autoBingoGranted: user.autoBingoGranted,
    autoMarkEnabled: user.autoMarkEnabled,
    autoBingoEnabled: user.autoBingoEnabled,
    featureSettingsVersion: user.featureSettingsVersion,
    ...computeEffectiveFeatureSettings(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
    counts: {
      ...user._count,
      winnerCartelas,
    },
  };
}
