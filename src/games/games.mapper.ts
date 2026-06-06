import { GameStatus } from '@prisma/client';
import {
  MyGameCartelaRecord,
  GameSlotRecord,
  GameSessionRecord,
} from './games.select';

type SerializedGameSlot = ReturnType<typeof serializeGameSlot>;
type SerializedGameSession = ReturnType<typeof serializeGameSession>;
type SerializedLatestSession = NonNullable<
  SerializedGameSlot['latestSession']
>;

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
        startedAt: latestSession.startedAt,
        finishedAt: latestSession.finishedAt,
        winnerCartelaId: latestSession.winnerCartelaId,
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
    entryFee: session.entryFee.toString(),
    prizePerCartela: session.prizePerCartela.toString(),
    companyFeePerCartela: session.companyFeePerCartela.toString(),
    prizeAmount: session.prizeAmount.toString(),
    companyRevenue: session.companyRevenue.toString(),
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    winnerCartelaId: session.winnerCartelaId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    registrationOpen: session.status === GameStatus.PLAYING,
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
