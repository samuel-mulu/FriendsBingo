import { MyGameCartelaRecord, GameSummaryRecord } from './games.select';

export function serializeGame(game: GameSummaryRecord) {
  return {
    id: game.id,
    code: game.code,
    name: game.name,
    gameType: game.gameType,
    entryFee: game.entryFee.toString(),
    prizeAmount: game.prizeAmount.toString(),
    status: game.status,
    startsAt: game.startsAt,
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
