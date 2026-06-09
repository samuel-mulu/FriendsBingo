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

// Select for public cartela summary (no user PII exposed)
// userId is included only to determine ownership (ME vs OTHER) during serialization
export const registeredCartelaSummarySelect =
  Prisma.validator<Prisma.GameCartelaSelect>()({
    id: true,
    cartelaId: true,
    userId: true, // Used server-side only to determine ownership, never exposed to client
    status: true,
    isWinner: true,
    cartela: {
      select: {
        id: true,
        number: true,
      },
    },
  });

export type RegisteredCartelaSummaryRecord =
  Prisma.GameCartelaGetPayload<{
    select: typeof registeredCartelaSummarySelect;
  }>;

export const activeCartelaReservationSummarySelect =
  Prisma.validator<Prisma.GameCartelaReservationSelect>()({
    cartelaId: true,
    userId: true,
    expiresAt: true,
    cartela: {
      select: {
        id: true,
        number: true,
      },
    },
  });

export type ActiveCartelaReservationSummaryRecord =
  Prisma.GameCartelaReservationGetPayload<{
    select: typeof activeCartelaReservationSummarySelect;
  }>;

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
  winnerWindowStartedAt: true,
  winnerWindowEndsAt: true,
  prizeFinalizedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      gameCartelas: true,
      calledNumbers: true,
    },
  },
  gameCartelas: {
    select: registeredCartelaSummarySelect,
    where: {
      status: {
        not: 'CANCELLED',
      },
    },
  },
  gameCartelaReservations: {
    select: activeCartelaReservationSummarySelect,
    where: {
      status: 'ACTIVE',
      expiresAt: {
        gt: new Date(),
      },
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
  autoCallEnabled: true,
  autoCallIntervalMs: true,
  nextAutoCallAt: true,
  startedAt: true,
  finishedAt: true,
  winnerCartelaId: true,
  winnerWindowStartedAt: true,
  winnerWindowEndsAt: true,
  prizeFinalizedAt: true,
  createdAt: true,
  updatedAt: true,
  gameSlot: {
    select: gameSlotBaseSelect,
  },
  gameCartelas: {
    select: registeredCartelaSummarySelect,
    where: {
      status: {
        not: 'CANCELLED',
      },
    },
  },
  gameCartelaReservations: {
    select: activeCartelaReservationSummarySelect,
    where: {
      status: 'ACTIVE',
      expiresAt: {
        gt: new Date(),
      },
    },
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
