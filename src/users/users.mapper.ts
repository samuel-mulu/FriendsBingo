import { serializeWallet } from '../wallet/wallet.mapper';
import {
  AdminUserDetailRecord,
  AdminUserListRecord,
  UserProfile,
  UserProfileWithWallet,
} from './users.select';

function toPublicUserFields(user: UserProfile) {
  const { password, blockReason, blockedAt, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(password),
    telegramLinked: Boolean(user.telegramId),
  };
}

export function serializeUser(user: UserProfile) {
  return toPublicUserFields(user);
}

export function serializeUserWithWallet(user: UserProfileWithWallet) {
  return {
    ...toPublicUserFields(user),
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
    counts: {
      ...user._count,
      winnerCartelas,
    },
  };
}
