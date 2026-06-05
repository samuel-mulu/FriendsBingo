import { Prisma, GameStatus } from '@prisma/client';

export const gameSlotSelect = Prisma.validator<Prisma.GameSlotSelect>()({
  id: true,
  staticCode: true,
  name: true,
  gameType: true,
  gameRuleId: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  gameRule: {
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      isActive: true,
      sortOrder: true,
    },
  },
});

export const gameSessionSelect = Prisma.validator<Prisma.GameSessionSelect>()({
  id: true,
  gameSlotId: true,
  playCode: true,
  entryFee: true,
  prizeAmount: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  winnerCartelaId: true,
  createdAt: true,
  updatedAt: true,
  gameSlot: {
    select: gameSlotSelect,
  },
  _count: {
    select: {
      gameCartelas: true,
    },
  },
});

export type GameSlotRecord = Prisma.GameSlotGetPayload<{
  select: typeof gameSlotSelect;
}>;

export type GameSessionRecord = Prisma.GameSessionGetPayload<{
  select: typeof gameSessionSelect;
}>;

export const myGameCartelaSelect =
  Prisma.validator<Prisma.GameCartelaSelect>()({
    id: true,
    gameSessionId: true,
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

export type MyGameCartelaRecord = Prisma.GameCartelaGetPayload<{
  select: typeof myGameCartelaSelect;
}>;

export const registerableGameStatuses: GameStatus[] = [
  GameStatus.NEXT,
];

export const playerVisibleGameStatuses: GameStatus[] = [
  GameStatus.NEXT,
  GameStatus.CHECKING,
  GameStatus.PLAYING,
];
