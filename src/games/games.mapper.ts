import { MyGameCartelaRecord, GameSummaryRecord } from './games.select';

export function serializeGame(game: GameSummaryRecord) {
  return {
    id: game.id,
    code: game.code,
    name: game.gameRule?.name ?? game.name,
    gameType: game.gameRule?.key ?? game.gameType,
    gameRuleId: game.gameRuleId,
    gameRule: game.gameRule,
    entryFee: game.entryFee.toString(),
    prizeAmount: game.prizeAmount.toString(),
    status: game.status,
    playOrder: game.playOrder,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    winnerCartelaId: game.winnerCartelaId,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    registeredCartelasCount: game._count.gameCartelas,
  };
}

export function serializeGameCartela(gameCartela: MyGameCartelaRecord) {
  return {
    ...gameCartela,
  };
}
