import { Prisma } from '@prisma/client';

const gameRuleSummarySelect = Prisma.validator<Prisma.GameRuleSelect>()({
  id: true,
  key: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
});

const gameSlotBaseSelect = Prisma.validator<Prisma.GameSlotSelect>()({
  id: true,
  staticCode: true,
  name: true,
  gameType: true,
  gameRuleId: true,
  status: true,
  entryFee: true,
  prizePerCartela: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  gameRule: {
    select: gameRuleSummarySelect,
  },
});

const slotLatestSessionSelect = Prisma.validator<Prisma.GameSessionSelect>()({
  id: true,
  gameSlotId: true,
  playCode: true,
  entryFee: true,
  prizePerCartela: true,
  companyFeePerCartela: true,
  prizeAmount: true,
  companyRevenue: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  winnerCartelaId: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      gameCartelas: true,
      calledNumbers: true,
    },
  },
});

export const gameSlotSelect = Prisma.validator<Prisma.GameSlotSelect>()({
  ...gameSlotBaseSelect,
  sessions: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: slotLatestSessionSelect,
  },
});

export const gameSessionSelect = Prisma.validator<Prisma.GameSessionSelect>()({
  id: true,
  gameSlotId: true,
  playCode: true,
  entryFee: true,
  prizePerCartela: true,
  companyFeePerCartela: true,
  prizeAmount: true,
  companyRevenue: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  winnerCartelaId: true,
  createdAt: true,
  updatedAt: true,
  gameSlot: {
    select: gameSlotBaseSelect,
  },
  _count: {
    select: {
      gameCartelas: true,
      calledNumbers: true,
    },
  },
});

export type GameSlotRecord = Prisma.GameSlotGetPayload<{
  select: typeof gameSlotSelect;
}>;

export type GameSessionRecord = Prisma.GameSessionGetPayload<{
  select: typeof gameSessionSelect;
}>;

export const myGameCartelaSelect = Prisma.validator<Prisma.GameCartelaSelect>()(
  {
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
  },
);

export type MyGameCartelaRecord = Prisma.GameCartelaGetPayload<{
  select: typeof myGameCartelaSelect;
}>;
