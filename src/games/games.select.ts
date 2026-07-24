import { Prisma } from '@prisma/client';

/**
 * Count filter for "cartelas in the game": excludes CANCELLED cartelas so
 * refunded/cancelled registrations never inflate registeredCartelasCount or
 * keep an empty AUTO session alive.
 */
const activeGameCartelasCountFilter = {
  where: { status: { not: 'CANCELLED' as const } },
};

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
  category: true,
  fixedPrizeAmount: true,
  maxCartelasPerPlayer: true,
  removeAfterFinish: true,
  sortOrder: true,
  operationMode: true,
  registrationDurationSeconds: true,
  autoCallIntervalSeconds: true,
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

export type RegisteredCartelaSummaryRecord = Prisma.GameCartelaGetPayload<{
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
  noWinnerGraceEndsAt: true,
  noWinnerReason: true,
  winnerWindowStartedAt: true,
  winnerWindowEndsAt: true,
  prizeFinalizedAt: true,
  registrationOpensAt: true,
  scheduledStartAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      gameCartelas: activeGameCartelasCountFilter,
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
  cancelledReason: true,
  winnerCartelaId: true,
  noWinnerGraceEndsAt: true,
  noWinnerReason: true,
  winnerWindowStartedAt: true,
  winnerWindowEndsAt: true,
  prizeFinalizedAt: true,
  registrationOpensAt: true,
  scheduledStartAt: true,
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
      gameCartelas: activeGameCartelasCountFilter,
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

export const registrationSessionMetricsSelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    id: true,
    gameSlotId: true,
    playCode: true,
    prizeAmount: true,
    status: true,
    _count: {
      select: {
        gameCartelas: activeGameCartelasCountFilter,
        calledNumbers: true,
      },
    },
  });

export type RegistrationSessionMetricsRecord = Prisma.GameSessionGetPayload<{
  select: typeof registrationSessionMetricsSelect;
}>;

export const operationsGameRuleSelect =
  Prisma.validator<Prisma.GameRuleSelect>()({
    id: true,
    name: true,
    key: true,
  });

export const operationsGameSlotSelect =
  Prisma.validator<Prisma.GameSlotSelect>()({
    id: true,
    staticCode: true,
    name: true,
    gameType: true,
    status: true,
    entryFee: true,
    prizePerCartela: true,
    category: true,
    fixedPrizeAmount: true,
    maxCartelasPerPlayer: true,
    sortOrder: true,
    operationMode: true,
    registrationDurationSeconds: true,
    autoCallIntervalSeconds: true,
    gameRule: {
      select: operationsGameRuleSelect,
    },
  });

export const operationsSessionCoreSelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    id: true,
    gameSlotId: true,
    playCode: true,
    entryFee: true,
    prizePerCartela: true,
    prizeAmount: true,
    status: true,
    startedAt: true,
    finishedAt: true,
    winnerCartelaId: true,
    noWinnerGraceEndsAt: true,
    noWinnerReason: true,
    winnerWindowStartedAt: true,
    winnerWindowEndsAt: true,
    registrationOpensAt: true,
    scheduledStartAt: true,
    _count: {
      select: {
        gameCartelas: activeGameCartelasCountFilter,
        calledNumbers: true,
      },
    },
  });

export const operationsSessionAdminExtraSelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    companyRevenue: true,
    autoCallEnabled: true,
    autoCallIntervalMs: true,
  });

export const operationsSnapshotSessionSelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    id: true,
    playCode: true,
    entryFee: true,
    prizePerCartela: true,
    prizeAmount: true,
    status: true,
    registrationOpensAt: true,
    scheduledStartAt: true,
    winnerWindowEndsAt: true,
    noWinnerGraceEndsAt: true,
    noWinnerReason: true,
    nextAutoCallAt: true,
    gameSlot: {
      select: operationsGameSlotSelect,
    },
    calledNumbers: {
      orderBy: { order: 'desc' },
      take: 1,
      select: { letter: true, number: true, order: true },
    },
    _count: {
      select: {
        gameCartelas: activeGameCartelasCountFilter,
        calledNumbers: true,
      },
    },
  });

export type OperationsSnapshotSessionRecord = Prisma.GameSessionGetPayload<{
  select: typeof operationsSnapshotSessionSelect;
}>;

export const operationsQueueSlotSelect =
  Prisma.validator<Prisma.GameSlotSelect>()({
    id: true,
    staticCode: true,
    entryFee: true,
    prizePerCartela: true,
    category: true,
    fixedPrizeAmount: true,
    maxCartelasPerPlayer: true,
    sortOrder: true,
    operationMode: true,
    status: true,
    registrationDurationSeconds: true,
    autoCallIntervalSeconds: true,
    gameRule: {
      select: operationsGameRuleSelect,
    },
  });

/** @deprecated Use operationsSessionCoreSelect + role-specific extras */
export const operationsSessionBaseSelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    ...operationsSessionCoreSelect,
    ...operationsSessionAdminExtraSelect,
  });

export const sessionCartelaSummarySelect =
  Prisma.validator<Prisma.GameSessionSelect>()({
    id: true,
    gameCartelas: gameSessionSelect.gameCartelas,
    gameCartelaReservations: gameSessionSelect.gameCartelaReservations,
  });

export type OperationsSessionBaseRecord = Prisma.GameSessionGetPayload<{
  select: typeof operationsSessionBaseSelect;
}>;

export const reservationConfirmSelect =
  Prisma.validator<Prisma.GameCartelaReservationSelect>()({
    id: true,
    userId: true,
    status: true,
    expiresAt: true,
    cartelaId: true,
    gameSessionId: true,
    gameSession: {
      select: {
        id: true,
        gameSlotId: true,
        playCode: true,
        entryFee: true,
        prizePerCartela: true,
        companyFeePerCartela: true,
        status: true,
        registrationOpensAt: true,
        scheduledStartAt: true,
        gameSlot: {
          select: {
            operationMode: true,
            category: true,
            maxCartelasPerPlayer: true,
          },
        },
      },
    },
  });

export type ReservationConfirmRecord = Prisma.GameCartelaReservationGetPayload<{
  select: typeof reservationConfirmSelect;
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
    paymentSource: true,
    entryFeeCents: true,
    prizeContributionCents: true,
    companyFeeCents: true,
    companyFeeSource: true,
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
