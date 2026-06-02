import { Prisma, WithdrawStatus } from '@prisma/client';
import { userProfileSelect } from '../users/users.select';

export const withdrawalSelect = Prisma.validator<Prisma.WithdrawalSelect>()({
  id: true,
  userId: true,
  provider: true,
  amount: true,
  receiverPhone: true,
  receiverAccount: true,
  payoutRef: true,
  status: true,
  adminNote: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
});

export const adminWithdrawalSelect =
  Prisma.validator<Prisma.WithdrawalSelect>()({
    ...withdrawalSelect,
    user: {
      select: userProfileSelect,
    },
  });

export type WithdrawalRecord = Prisma.WithdrawalGetPayload<{
  select: typeof withdrawalSelect;
}>;

export type AdminWithdrawalRecord = Prisma.WithdrawalGetPayload<{
  select: typeof adminWithdrawalSelect;
}>;

export const reversibleWithdrawalStatuses: WithdrawStatus[] = [
  WithdrawStatus.PENDING,
  WithdrawStatus.APPROVED,
];
