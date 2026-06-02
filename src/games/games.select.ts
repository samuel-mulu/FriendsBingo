import { Prisma, GameStatus } from '@prisma/client';

export const gameSummarySelect = Prisma.validator<Prisma.GameSelect>()({
  id: true,
  code: true,
  name: true,
  gameType: true,
  entryFee: true,
  prizeAmount: true,
  status: true,
  startsAt: true,
  startedAt: true,
  finishedAt: true,
  winnerCartelaId: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      gameCartelas: true,
    },
  },
});

export const myGameCartelaSelect =
  Prisma.validator<Prisma.GameCartelaSelect>()({
    id: true,
    gameId: true,
    userId: true,
    cartelaId: true,
    status: true,
    isWinner: true,
    markedCells: true,
    blockedAt: true,
    createdAt: true,
    updatedAt: true,
    cartela: {
      select: {
        id: true,
        number: true,
        b: true,
        i: true,
        n: true,
        g: true,
        o: true,
        createdAt: true,
      },
    },
  });

export type GameSummaryRecord = Prisma.GameGetPayload<{
  select: typeof gameSummarySelect;
}>;

export type MyGameCartelaRecord = Prisma.GameCartelaGetPayload<{
  select: typeof myGameCartelaSelect;
}>;

export const registerableGameStatuses: GameStatus[] = [
  GameStatus.NEXT,
  GameStatus.CHECKING,
];
