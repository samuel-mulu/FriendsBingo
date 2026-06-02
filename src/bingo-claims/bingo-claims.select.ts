import { BingoClaimStatus, Prisma } from '@prisma/client';

export const bingoClaimSelect = Prisma.validator<Prisma.BingoClaimSelect>()({
  id: true,
  gameId: true,
  userId: true,
  gameCartelaId: true,
  status: true,
  checkedPattern: true,
  reason: true,
  createdAt: true,
  checkedAt: true,
});

export type BingoClaimRecord = Prisma.BingoClaimGetPayload<{
  select: typeof bingoClaimSelect;
}>;

export const finalClaimStatuses: BingoClaimStatus[] = [
  BingoClaimStatus.VALID,
  BingoClaimStatus.INVALID,
];
