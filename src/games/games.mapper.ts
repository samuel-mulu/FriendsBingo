import {
  MyGameCartelaRecord,
  GameSlotRecord,
  GameSessionRecord,
} from './games.select';

export function serializeGameSlot(slot: GameSlotRecord) {
  return {
    id: slot.id,
    staticCode: slot.staticCode,
    name: slot.gameRule?.name ?? slot.name,
    gameType: slot.gameRule?.key ?? slot.gameType,
    gameRuleId: slot.gameRuleId,
    gameRule: slot.gameRule,
    status: slot.status,
    sortOrder: slot.sortOrder,
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
}

export function serializeGameSession(session: GameSessionRecord) {
  return {
    id: session.id,
    gameSlotId: session.gameSlotId,
    playCode: session.playCode,
    name: session.gameSlot.gameRule?.name ?? session.gameSlot.name,
    gameType: session.gameSlot.gameRule?.key ?? session.gameSlot.gameType,
    entryFee: session.entryFee.toString(),
    prizeAmount: session.prizeAmount.toString(),
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    winnerCartelaId: session.winnerCartelaId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    gameSlot: serializeGameSlot(session.gameSlot),
    registeredCartelasCount: session._count.gameCartelas,
  };
}

export function serializeGameCartela(gameCartela: MyGameCartelaRecord) {
  return {
    ...gameCartela,
  };
}
