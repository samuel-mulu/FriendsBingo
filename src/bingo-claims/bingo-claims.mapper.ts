import { BingoClaimRecord } from './bingo-claims.select';

export function serializeBingoClaim(claim: BingoClaimRecord) {
  return {
    id: claim.id,
    gameId: claim.gameId,
    userId: claim.userId,
    gameCartelaId: claim.gameCartelaId,
    status: claim.status,
    checkedPattern: claim.checkedPattern,
    reason: claim.reason,
    createdAt: claim.createdAt,
    checkedAt: claim.checkedAt,
    user: claim.user,
    game: {
      ...claim.game,
      prizeAmount: claim.game.prizeAmount.toString(),
    },
    gameCartela: claim.gameCartela,
  };
}
