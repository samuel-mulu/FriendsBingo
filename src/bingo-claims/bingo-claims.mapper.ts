import { BingoClaimRecord } from './bingo-claims.select';

export function serializeBingoClaim(claim: BingoClaimRecord) {
  return {
    id: claim.id,
    gameSessionId: claim.gameSessionId,
    userId: claim.userId,
    gameCartelaId: claim.gameCartelaId,
    status: claim.status,
    checkedPattern: claim.checkedPattern,
    reason: claim.reason,
    createdAt: claim.createdAt,
    checkedAt: claim.checkedAt,
    user: claim.user,
    gameSession: {
      ...claim.gameSession,
      prizeAmount: claim.gameSession.prizeAmount.toString(),
      gameSlot: {
        ...claim.gameSession.gameSlot,
      },
    },
    gameCartela: claim.gameCartela,
  };
}
