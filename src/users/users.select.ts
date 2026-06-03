import { Prisma } from '@prisma/client';
import { walletSelect } from '../wallet/wallet.select';

export const userProfileSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  fullName: true,
  phoneNumber: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export const userProfileWithWalletSelect =
  Prisma.validator<Prisma.UserSelect>()({
    id: true,
    fullName: true,
    phoneNumber: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
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
  createdAt: true,
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
  createdAt: true,
  updatedAt: true,
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

export type UserProfileWithWallet = Prisma.UserGetPayload<{
  select: typeof userProfileWithWalletSelect;
}>;

export type AdminUserListRecord = Prisma.UserGetPayload<{
  select: typeof adminUserListSelect;
}>;

export type AdminUserDetailRecord = Prisma.UserGetPayload<{
  select: typeof adminUserDetailSelect;
}>;
