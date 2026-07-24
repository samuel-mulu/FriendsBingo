import { GameOperationMode, GameStatus, Prisma } from '@prisma/client';
import { splitPrizeAmount } from '../bingo-claims/prize-split.util';
import { isBigGameCategory, isBonusCategory } from './game-category.util';
import {
  canRegisterForBigGameWindow,
  canRegisterForOperationMode,
} from './games.operation-mode';
import { SessionWinnerResult } from './session-winner-results.builder';
import {
  MyGameCartelaRecord,
  GameSlotRecord,
  GameSessionRecord,
  RegisteredCartelaSummaryRecord,
  ActiveCartelaReservationSummaryRecord,
} from './games.select';

export type WinnerPayoutSummary = {
  cartelaId: string;
  cartelaNumber: number;
  amount: string;
  owner?: 'ME' | 'OTHER';
};

type SerializedGameSlot = ReturnType<typeof serializeGameSlot>;
type SerializedGameSession = ReturnType<typeof serializeGameSession>;
type SerializedLatestSession = NonNullable<SerializedGameSlot['latestSession']>;
type TerminalSessionContext = Pick<
  SerializedGameSession,
  | 'sessionId'
  | 'playCode'
  | 'entryFee'
  | 'prizePerCartela'
  | 'prizeAmount'
  | 'status'
  | 'startedAt'
  | 'finishedAt'
  | 'winnerCartelaId'
  | 'noWinnerGraceEndsAt'
  | 'noWinnerReason'
  | 'registeredCartelasCount'
  | 'calledNumbersCount'
> & {
  winnerPayoutsSummary?: WinnerPayoutSummary[];
  winnerResults?: SessionWinnerResult[];
};

function stripCompanyFinancialsFromSessionSummary(
  summary: SerializedLatestSession,
) {
  const { companyFeePerCartela, companyRevenue, ...rest } = summary;
  return rest;
}

export function toPlayerGameSlot(payload: SerializedGameSlot) {
  const { companyFeePerCartela, companyRevenue, latestSession, ...rest } =
    payload;

  return {
    ...rest,
    latestSession: latestSession
      ? stripCompanyFinancialsFromSessionSummary(latestSession)
      : null,
  };
}

export function toPlayerGameSession(payload: SerializedGameSession) {
  const { companyFeePerCartela, companyRevenue, ...rest } = payload;
  return rest;
}

export function withTerminalSessionContextForPlayerSlot(
  payload: ReturnType<typeof toPlayerGameSlot>,
  session: TerminalSessionContext,
) {
  return {
    ...payload,
    sessionId: session.sessionId,
    playCode: session.playCode,
    entryFee: session.entryFee,
    prizePerCartela: session.prizePerCartela,
    prizeAmount: session.prizeAmount,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    winnerCartelaId: session.winnerCartelaId,
    noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
    noWinnerReason: session.noWinnerReason,
    registeredCartelasCount: session.registeredCartelasCount,
    calledNumbersCount: session.calledNumbersCount,
    winnerPayoutsSummary: session.winnerPayoutsSummary,
    winnerResults: session.winnerResults,
  };
}

export function withTerminalSessionContextForAdminSlot(
  payload: SerializedGameSlot,
  session: TerminalSessionContext & {
    companyFeePerCartela: SerializedGameSession['companyFeePerCartela'];
    companyRevenue: SerializedGameSession['companyRevenue'];
  },
) {
  return {
    ...payload,
    sessionId: session.sessionId,
    playCode: session.playCode,
    entryFee: session.entryFee,
    prizePerCartela: session.prizePerCartela,
    companyFeePerCartela: session.companyFeePerCartela,
    prizeAmount: session.prizeAmount,
    companyRevenue: session.companyRevenue,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    winnerCartelaId: session.winnerCartelaId,
    noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
    noWinnerReason: session.noWinnerReason,
    registeredCartelasCount: session.registeredCartelasCount,
    calledNumbersCount: session.calledNumbersCount,
    winnerPayoutsSummary: session.winnerPayoutsSummary,
    winnerResults: session.winnerResults,
  };
}

function serializeGameSlotBase(
  slot: GameSlotRecord | GameSessionRecord['gameSlot'],
) {
  return {
    id: slot.id,
    staticCode: slot.staticCode,
    name: slot.gameRule?.name ?? slot.name,
    gameType: slot.gameRule?.key ?? slot.gameType,
    gameRuleId: slot.gameRuleId,
    gameRule: slot.gameRule,
    status: slot.status,
    category: slot.category,
    isBonus: isBonusCategory(slot.category),
    isBigGame: isBigGameCategory(slot.category),
    fixedPrizeAmount: slot.fixedPrizeAmount?.toString() ?? null,
    maxCartelasPerPlayer: slot.maxCartelasPerPlayer,
    sortOrder: slot.sortOrder,
    entryFee: slot.entryFee.toString(),
    prizePerCartela: slot.prizePerCartela.toString(),
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
}

function getActiveSession(slot: GameSlotRecord) {
  const latestSession = slot.sessions[0] ?? null;

  if (
    !latestSession ||
    (latestSession.status !== GameStatus.PLAYING &&
      latestSession.status !== GameStatus.WINNER_WINDOW &&
      latestSession.status !== GameStatus.CHECKING)
  ) {
    return null;
  }

  return latestSession;
}

export function serializeGameSlot(slot: GameSlotRecord) {
  const activeSession = getActiveSession(slot);
  const latestSession = activeSession;
  const latestSessionSummary = latestSession
    ? {
        id: latestSession.id,
        sessionId: latestSession.id,
        playCode: latestSession.playCode,
        entryFee: latestSession.entryFee.toString(),
        prizePerCartela: latestSession.prizePerCartela.toString(),
        companyFeePerCartela: latestSession.companyFeePerCartela.toString(),
        prizeAmount: latestSession.prizeAmount.toString(),
        companyRevenue: latestSession.companyRevenue.toString(),
        status: latestSession.status,
        registrationOpensAt: latestSession.registrationOpensAt,
        scheduledStartAt: latestSession.scheduledStartAt,
        startedAt: latestSession.startedAt,
        finishedAt: latestSession.finishedAt,
        winnerCartelaId: latestSession.winnerCartelaId,
        noWinnerGraceEndsAt: latestSession.noWinnerGraceEndsAt,
        noWinnerReason: latestSession.noWinnerReason,
        registeredCartelasCount: latestSession._count.gameCartelas,
        calledNumbersCount: latestSession._count.calledNumbers,
      }
    : null;

  return {
    ...serializeGameSlotBase(slot),
    code: slot.staticCode,
    playOrder: slot.sortOrder,
    sessionId: latestSession?.id ?? null,
    playCode: latestSession?.playCode ?? null,
    entryFee: activeSession
      ? activeSession.entryFee.toString()
      : slot.entryFee.toString(),
    prizePerCartela: activeSession
      ? activeSession.prizePerCartela.toString()
      : slot.prizePerCartela.toString(),
    companyFeePerCartela: activeSession
      ? activeSession.companyFeePerCartela.toString()
      : '0',
    prizeAmount: activeSession?.prizeAmount.toString() ?? '0',
    companyRevenue: activeSession?.companyRevenue.toString() ?? '0',
    registrationOpensAt: slot.sessions[0]?.registrationOpensAt ?? null,
    scheduledStartAt: slot.sessions[0]?.scheduledStartAt ?? null,
    startedAt: latestSession?.startedAt ?? null,
    finishedAt: latestSession?.finishedAt ?? null,
    winnerCartelaId: latestSession?.winnerCartelaId ?? null,
    registeredCartelasCount: latestSession?._count.gameCartelas ?? 0,
    calledNumbersCount: latestSession?._count.calledNumbers ?? 0,
    registrationOpen: false,
    latestSession: latestSessionSummary,
  };
}

export function serializeGameSession(session: GameSessionRecord) {
  const registrationOpen = isBigGameCategory(session.gameSlot.category)
    ? session.status === GameStatus.READY &&
      canRegisterForBigGameWindow(
        session.registrationOpensAt,
        session.scheduledStartAt,
      )
    : canRegisterForOperationMode(
        session.gameSlot.operationMode ?? GameOperationMode.MANUAL,
        session.status,
        session.scheduledStartAt,
      );

  return {
    id: session.id,
    sessionId: session.id,
    gameSlotId: session.gameSlotId,
    staticCode: session.gameSlot.staticCode,
    playCode: session.playCode,
    code: session.playCode,
    playOrder: session.gameSlot.sortOrder,
    name: session.gameSlot.gameRule?.name ?? session.gameSlot.name,
    gameType: session.gameSlot.gameRule?.key ?? session.gameSlot.gameType,
    gameRuleId: session.gameSlot.gameRuleId,
    gameRule: session.gameSlot.gameRule,
    category: session.gameSlot.category,
    isBonus: isBonusCategory(session.gameSlot.category),
    isBigGame: isBigGameCategory(session.gameSlot.category),
    fixedPrizeAmount: session.gameSlot.fixedPrizeAmount?.toString() ?? null,
    maxCartelasPerPlayer: session.gameSlot.maxCartelasPerPlayer,
    entryFee: session.entryFee.toString(),
    prizePerCartela: session.prizePerCartela.toString(),
    companyFeePerCartela: session.companyFeePerCartela.toString(),
    prizeAmount: session.prizeAmount.toString(),
    companyRevenue: session.companyRevenue.toString(),
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    cancelledReason: session.cancelledReason,
    winnerCartelaId: session.winnerCartelaId,
    noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
    noWinnerReason: session.noWinnerReason,
    winnerWindowStartedAt: session.winnerWindowStartedAt,
    winnerWindowEndsAt: session.winnerWindowEndsAt,
    prizeFinalizedAt: session.prizeFinalizedAt,
    registrationOpensAt: session.registrationOpensAt,
    scheduledStartAt: session.scheduledStartAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    registrationOpen,
    registeredCartelasCount: session._count.gameCartelas,
    calledNumbersCount: session._count.calledNumbers,
    gameSlot: serializeGameSlotBase(session.gameSlot),
  };
}

export function serializeGameSlotForPlayer(slot: GameSlotRecord) {
  return toPlayerGameSlot(serializeGameSlot(slot));
}

export function serializeGameSessionForPlayer(session: GameSessionRecord) {
  return toPlayerGameSession(serializeGameSession(session));
}

export function serializeGameCartela(gameCartela: MyGameCartelaRecord) {
  return {
    ...gameCartela,
  };
}

export function serializeMyAttendedHistoryItem(
  session: GameSessionRecord,
  myCartelas: MyGameCartelaRecord[],
) {
  return {
    ...serializeGameSessionForPlayer(session),
    myCartelas: myCartelas.map(serializeGameCartela),
  };
}

export function serializeRegisteredCartelaSummary(
  cartela: RegisteredCartelaSummaryRecord,
  requestingUserId?: string,
) {
  const owner =
    requestingUserId == null
      ? 'OTHER'
      : cartela.userId === requestingUserId
        ? 'ME'
        : 'OTHER';
  return {
    cartelaId: cartela.cartelaId,
    cartelaNumber: cartela.cartela.number,
    owner,
    status: cartela.isWinner ? 'WINNER' : cartela.status,
  };
}

export function serializeReservedCartelaSummary(
  reservation: ActiveCartelaReservationSummaryRecord,
  requestingUserId?: string,
) {
  const owner =
    requestingUserId == null
      ? 'RESERVED_OTHER'
      : reservation.userId === requestingUserId
        ? 'RESERVED_ME'
        : 'RESERVED_OTHER';
  return {
    cartelaId: reservation.cartelaId,
    cartelaNumber: reservation.cartela.number,
    owner,
    status: 'RESERVED' as const,
    expiresAt: reservation.expiresAt.toISOString(),
  };
}

export type SessionCartelaChangeOwner =
  | 'ME'
  | 'OTHER'
  | 'RESERVED_ME'
  | 'RESERVED_OTHER'
  | 'AVAILABLE';

export type SessionCartelaChange = {
  cartelaId: string;
  cartelaNumber: number;
  owner: SessionCartelaChangeOwner;
  expiresAt?: string;
  actorUserId?: string;
};

export function buildSessionCartelaChange(params: {
  cartelaId: string;
  cartelaNumber: number;
  kind: 'AVAILABLE' | 'RESERVED' | 'REGISTERED';
  userId?: string;
  expiresAt?: Date | string;
}): SessionCartelaChange {
  const { cartelaId, cartelaNumber, kind, userId, expiresAt } = params;

  if (kind === 'AVAILABLE') {
    return {
      cartelaId,
      cartelaNumber,
      owner: 'AVAILABLE',
    };
  }

  const expiresAtIso =
    expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;

  if (kind === 'RESERVED') {
    return {
      cartelaId,
      cartelaNumber,
      owner: 'RESERVED_OTHER',
      actorUserId: userId,
      ...(expiresAtIso ? { expiresAt: expiresAtIso } : {}),
    };
  }

  return {
    cartelaId,
    cartelaNumber,
    owner: 'OTHER',
    actorUserId: userId,
  };
}

export type SerializedCartelaSummary =
  | ReturnType<typeof serializeRegisteredCartelaSummary>
  | ReturnType<typeof serializeReservedCartelaSummary>;

export function buildRegisteredCartelasSummary(
  registrations: RegisteredCartelaSummaryRecord[],
  reservations: ActiveCartelaReservationSummaryRecord[],
  requestingUserId?: string,
): SerializedCartelaSummary[] {
  const summaryByCartelaId = new Map<string, SerializedCartelaSummary>();

  for (const registration of registrations) {
    summaryByCartelaId.set(
      registration.cartelaId,
      serializeRegisteredCartelaSummary(registration, requestingUserId),
    );
  }

  for (const reservation of reservations) {
    if (summaryByCartelaId.has(reservation.cartelaId)) {
      continue;
    }

    summaryByCartelaId.set(
      reservation.cartelaId,
      serializeReservedCartelaSummary(reservation, requestingUserId),
    );
  }

  return Array.from(summaryByCartelaId.values());
}

export function serializeWinnerPayoutsSummary(
  winners: RegisteredCartelaSummaryRecord[],
  prizeAmount: Prisma.Decimal,
  requestingUserId?: string,
): WinnerPayoutSummary[] | undefined {
  if (winners.length === 0) {
    return undefined;
  }

  const shares = splitPrizeAmount(prizeAmount, winners.length);

  return winners.map((cartela, index) => ({
    cartelaId: cartela.cartelaId,
    cartelaNumber: cartela.cartela.number,
    amount: shares[index].toFixed(2),
    ...(requestingUserId
      ? {
          owner:
            cartela.userId === requestingUserId
              ? ('ME' as const)
              : ('OTHER' as const),
        }
      : {}),
  }));
}

export function serializeWinnerCartelaSummary(
  cartela: RegisteredCartelaSummaryRecord,
) {
  return {
    gameCartelaId: cartela.id,
    cartelaId: cartela.cartelaId,
    cartelaNumber: cartela.cartela.number,
  };
}

export function serializeGameSessionWithCartelaSummary(
  session: GameSessionRecord,
  requestingUserId: string,
) {
  const base = serializeGameSession(session);
  return {
    ...base,
    registeredCartelasSummary: buildRegisteredCartelasSummary(
      session.gameCartelas,
      session.gameCartelaReservations,
      requestingUserId,
    ),
  };
}
