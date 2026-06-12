import { BingoClaimReasonCode as PrismaBingoClaimReasonCode } from '@prisma/client';
import {
  BingoClaimRecord,
  CreatedPlayerBingoClaimRecord,
} from './bingo-claims.select';

export type BingoClaimReasonCode = PrismaBingoClaimReasonCode;

type SerializeClaimOptions = {
  reasonCode?: BingoClaimReasonCode | null;
};

export function serializePlayerBingoClaim(
  claim: CreatedPlayerBingoClaimRecord,
  options?: SerializeClaimOptions,
) {
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
    reasonCode: options?.reasonCode ?? claim.reasonCode ?? null,
  };
}

export function serializeBingoClaim(
  claim: BingoClaimRecord,
  options?: SerializeClaimOptions,
) {
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
    reasonCode: options?.reasonCode ?? claim.reasonCode ?? null,
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
