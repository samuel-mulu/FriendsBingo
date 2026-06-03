import { serializeWallet } from '../wallet/wallet.mapper';
import {
  AdminUserDetailRecord,
  AdminUserListRecord,
  UserProfile,
  UserProfileWithWallet,
} from './users.select';

export function serializeUser(user: UserProfile) {
  return user;
}

export function serializeUserWithWallet(user: UserProfileWithWallet) {
  return {
    ...user,
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
    walletBalance: user.wallet?.balance.toString() ?? '0',
    createdAt: user.createdAt,
  };
}

export function serializeAdminUserDetail(user: AdminUserDetailRecord) {
  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
    counts: user._count,
  };
}
