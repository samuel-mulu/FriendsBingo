import { BingoClaimStatus, Prisma } from '@prisma/client';

export const createdPlayerBingoClaimSelect =
  Prisma.validator<Prisma.BingoClaimSelect>()({
    id: true,
    gameSessionId: true,
    userId: true,
    gameCartelaId: true,
    status: true,
    checkedPattern: true,
    reason: true,
    reasonCode: true,
    winningBallLetter: true,
    winningBallNumber: true,
    createdAt: true,
    checkedAt: true,
  });

export type CreatedPlayerBingoClaimRecord = Prisma.BingoClaimGetPayload<{
  select: typeof createdPlayerBingoClaimSelect;
}>;

export const bingoClaimSelect = Prisma.validator<Prisma.BingoClaimSelect>()({
  id: true,
  gameSessionId: true,
  userId: true,
  gameCartelaId: true,
  status: true,
  checkedPattern: true,
  reason: true,
  reasonCode: true,
  createdAt: true,
  checkedAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
    },
  },
  gameSession: {
    select: {
      id: true,
      playCode: true,
      status: true,
      prizeAmount: true,
      gameSlot: {
        select: {
          id: true,
          gameType: true,
          name: true,
          gameRule: {
            select: {
              id: true,
              key: true,
              name: true,
            },
          },
        },
      },
    },
  },
  gameCartela: {
    select: {
      id: true,
      status: true,
      isWinner: true,
      blockedAt: true,
      cartela: {
        select: {
          id: true,
          number: true,
        },
      },
    },
  },
});

export type BingoClaimRecord = Prisma.BingoClaimGetPayload<{
  select: typeof bingoClaimSelect;
}>;

export const finalClaimStatuses: BingoClaimStatus[] = [
  BingoClaimStatus.VALID,
  BingoClaimStatus.INVALID,
];
