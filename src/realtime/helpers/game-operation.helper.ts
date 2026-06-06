import { GameOperationPayload } from '../types/game-operation-payload.type';

type SerializedSlot = {
  id: string;
  staticCode: string;
  playCode: string | null;
  sessionId: string | null;
  status: string;
  entryFee: string;
  prizeAmount: string;
  registeredCartelasCount: number;
  calledNumbersCount: number;
  gameRule: {
    id: string;
    key: string;
    name: string;
  } | null;
  sortOrder: number | null;
};

type SerializedSession = {
  id: string;
  sessionId: string;
  gameSlotId: string;
  staticCode: string;
  playCode: string;
  status: string;
  entryFee: string;
  prizeAmount: string;
  registeredCartelasCount: number;
  calledNumbersCount: number;
  gameRule: {
    id: string;
    key: string;
    name: string;
  } | null;
  playOrder: number | null;
};

export function buildGameOperationPayload(
  data: SerializedSlot | SerializedSession,
  updatedReason: string,
): GameOperationPayload {
  if ('gameSlotId' in data) {
    return {
      slotId: data.gameSlotId,
      sessionId: data.sessionId,
      staticCode: data.staticCode,
      playCode: data.playCode,
      status: data.status,
      entryFee: data.entryFee,
      prizeAmount: data.prizeAmount,
      registeredCartelasCount: data.registeredCartelasCount,
      calledNumbersCount: data.calledNumbersCount,
      gameRule: data.gameRule,
      sortOrder: data.playOrder,
      updatedReason,
    };
  }

  return {
    slotId: data.id,
    sessionId: data.sessionId,
    staticCode: data.staticCode,
    playCode: data.playCode,
    status: data.status,
    entryFee: data.entryFee,
    prizeAmount: data.prizeAmount,
    registeredCartelasCount: data.registeredCartelasCount,
    calledNumbersCount: data.calledNumbersCount,
    gameRule: data.gameRule,
    sortOrder: data.sortOrder,
    updatedReason,
  };
}

export function stripCompanyFinancials(
  payload: GameOperationPayload,
): GameOperationPayload {
  return payload;
}
