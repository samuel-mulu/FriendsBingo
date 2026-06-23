import { DepositStatus, Prisma } from '@prisma/client';
import { userProfileSelect } from '../users/users.select';

export const depositSelect = {
  id: true,
  userId: true,
  provider: true,
  amount: true,
  transactionRef: true,
  receiptUrl: true,
  walletTransactionId: true,
  status: true,
  rejectionReason: true,
  verifiedAmount: true,
  verifiedReceiverName: true,
  createdAt: true,
  verifiedAt: true,
  updatedAt: true,
} satisfies Prisma.DepositSelect;

export const adminDepositSelect = {
  id: true,
  userId: true,
  provider: true,
  amount: true,
  transactionRef: true,
  receiptUrl: true,
  walletTransactionId: true,
  status: true,
  verifiedData: true,
  rejectionReason: true,
  verifyEtRequestId: true,
  verifyEtRawResponse: true,
  verifiedAmount: true,
  verifiedReceiverName: true,
  createdAt: true,
  verifiedAt: true,
  updatedAt: true,
  user: {
    select: userProfileSelect,
  },
} satisfies Prisma.DepositSelect;

export type DepositRecord = Prisma.DepositGetPayload<{
  select: typeof depositSelect;
}>;

export type AdminDepositRecord = Prisma.DepositGetPayload<{
  select: typeof adminDepositSelect;
}>;

export const updatableDepositStatuses: DepositStatus[] = [DepositStatus.PENDING];
