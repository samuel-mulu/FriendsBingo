import { GameStatus } from '@prisma/client';
import {
  exposedMaxCartelasPerPlayer,
  getBonusCartelaLimit,
  isBonusCategory,
} from './game-category.util';
import { RegistrationStateView } from './dto/registration-state-query.dto';
import {
  buildRegisteredCartelasSummary,
  serializeRegisteredCartelaSummary,
  serializeReservedCartelaSummary,
} from './games.mapper';
import {
  ActiveCartelaReservationSummaryRecord,
  RegisteredCartelaSummaryRecord,
} from './games.select';

export interface SharedRegistrationSnapshot {
  sessionId: string;
  session: {
    status: GameStatus;
    entryFee: { toString(): string };
    gameSlot: {
      category: import('@prisma/client').GameCategory;
      fixedPrizeAmount: { toString(): string } | null;
      maxCartelasPerPlayer: number | null;
    };
  };
  gameCartelas: RegisteredCartelaSummaryRecord[];
  gameCartelaReservations: ActiveCartelaReservationSummaryRecord[];
  liveLockedCartelas: RegisteredCartelaSummaryRecord[];
  liveLockedReservations: ActiveCartelaReservationSummaryRecord[];
}

export function buildRegistrationStateForUser(
  snapshot: SharedRegistrationSnapshot,
  requestingUserId?: string,
  view: RegistrationStateView = 'full',
) {
  const { sessionId, session, gameCartelas, gameCartelaReservations } =
    snapshot;

  const registeredCartelasSummary = buildRegisteredCartelasSummary(
    gameCartelas,
    gameCartelaReservations,
    requestingUserId,
  );
  let mergedSummary = registeredCartelasSummary;

  if (
    session.status === GameStatus.READY &&
    (snapshot.liveLockedCartelas.length > 0 ||
      snapshot.liveLockedReservations.length > 0)
  ) {
    const summaryByCartelaId = new Map(
      registeredCartelasSummary.map((item) => [item.cartelaId, item]),
    );

    for (const item of snapshot.liveLockedCartelas) {
      if (!summaryByCartelaId.has(item.cartelaId)) {
        summaryByCartelaId.set(
          item.cartelaId,
          serializeRegisteredCartelaSummary(item, requestingUserId),
        );
      }
    }

    for (const item of snapshot.liveLockedReservations) {
      if (!summaryByCartelaId.has(item.cartelaId)) {
        summaryByCartelaId.set(
          item.cartelaId,
          serializeReservedCartelaSummary(item, requestingUserId),
        );
      }
    }

    mergedSummary = [...summaryByCartelaId.values()];
  }

  // Counts are this-session only. mergedSummary may still include live-locked
  // cartelas so the next-game grid can show availability locks.
  const registeredCartelasCount = registeredCartelasSummary.filter(
    (item) => item.status === 'REGISTERED',
  ).length;
  const reservedCartelasCount = registeredCartelasSummary.filter(
    (item) => item.status === 'RESERVED',
  ).length;
  const reservedCartelasSummary = mergedSummary.filter(
    (item) => item.status === 'RESERVED',
  );
  const myCartelaIds =
    requestingUserId == null
      ? []
      : gameCartelas
          .filter((cartela) => cartela.userId === requestingUserId)
          .map((cartela) => cartela.cartelaId);
  const myRegisteredCartelasCount = myCartelaIds.length;

  const basePayload = {
    sessionId,
    registeredCartelasSummary: mergedSummary,
    myCartelaIds,
    category: session.gameSlot.category,
    entryFee: session.entryFee.toString(),
    fixedPrizeAmount: session.gameSlot.fixedPrizeAmount?.toString() ?? null,
    maxCartelasPerPlayer: exposedMaxCartelasPerPlayer(
      session.gameSlot.category,
      session.gameSlot.maxCartelasPerPlayer,
    ),
    remainingFreeCartelas:
      isBonusCategory(session.gameSlot.category) && requestingUserId != null
        ? Math.max(
            getBonusCartelaLimit(session.gameSlot.maxCartelasPerPlayer) -
              myRegisteredCartelasCount,
            0,
          )
        : null,
    registeredCartelasCount,
    reservedCartelasCount,
  };

  if (view === 'slim') {
    return basePayload;
  }

  return {
    ...basePayload,
    reservedCartelasSummary,
  };
}
