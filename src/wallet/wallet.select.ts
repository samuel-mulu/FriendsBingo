import { Prisma } from '@prisma/client';

export const walletSelect = Prisma.validator<Prisma.WalletSelect>()({
  id: true,
  userId: true,
  balance: true,
  lockedBalance: true,
  bonusCartelaBalance: true,
  createdAt: true,
  updatedAt: true,
});

export type WalletRecord = Prisma.WalletGetPayload<{
  select: typeof walletSelect;
}>;

export const walletTransactionSelect =
  Prisma.validator<Prisma.WalletTransactionSelect>()({
    id: true,
    userId: true,
    type: true,
    amount: true,
    balanceBefore: true,
    balanceAfter: true,
    referenceType: true,
    referenceId: true,
    description: true,
    createdAt: true,
  });

export type WalletTransactionRecord = Prisma.WalletTransactionGetPayload<{
  select: typeof walletTransactionSelect;
}>;
