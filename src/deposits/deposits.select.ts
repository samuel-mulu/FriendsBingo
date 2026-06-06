import { DepositStatus, Prisma } from '@prisma/client';
import { userProfileSelect } from '../users/users.select';

export const depositSelect = Prisma.validator<Prisma.DepositSelect>()({
  id: true,
  userId: true,
  provider: true,
  amount: true,
  transactionRef: true,
  status: true,
  rejectionReason: true,
  createdAt: true,
  verifiedAt: true,
  updatedAt: true,
});

export const adminDepositSelect = Prisma.validator<Prisma.DepositSelect>()({
  id: true,
  userId: true,
  provider: true,
  amount: true,
  transactionRef: true,
  status: true,
  verifiedData: true,
  rejectionReason: true,
  createdAt: true,
  verifiedAt: true,
  updatedAt: true,
  user: {
    select: userProfileSelect,
  },
});

export type DepositRecord = Prisma.DepositGetPayload<{
  select: typeof depositSelect;
}>;

export type AdminDepositRecord = Prisma.DepositGetPayload<{
  select: typeof adminDepositSelect;
}>;

export const updatableDepositStatuses: DepositStatus[] = [
  DepositStatus.PENDING,
  DepositStatus.VERIFYING,
  DepositStatus.MANUAL_REVIEW,
];

export const retryableDepositStatuses: DepositStatus[] = [
  DepositStatus.VERIFYING,
  DepositStatus.MANUAL_REVIEW,
];
