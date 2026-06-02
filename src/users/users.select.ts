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

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof userProfileSelect;
}>;

export type UserProfileWithWallet = Prisma.UserGetPayload<{
  select: typeof userProfileWithWalletSelect;
}>;
