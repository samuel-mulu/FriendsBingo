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
    claimAttemptId: claim.claimAttemptId,
    gameSessionId: claim.gameSessionId,
    userId: claim.userId,
    gameCartelaId: claim.gameCartelaId,
    status: claim.status,
    attemptNumber: claim.attemptNumber,
    checkedPattern: claim.checkedPattern,
    reason: claim.reason,
    failureCode: claim.failureCode,
    failureMessage: claim.failureMessage,
    receivedAt: claim.receivedAt,
    completedAt: claim.completedAt,
    durationMs: claim.durationMs,
    receiptBallLetter: claim.receiptBallLetter,
    receiptBallNumber: claim.receiptBallNumber,
    receiptCalledOrder: claim.receiptCalledOrder,
    calledNumbersCountAtReceipt: claim.calledNumbersCountAtReceipt,
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
    claimAttemptId: claim.claimAttemptId,
    gameSessionId: claim.gameSessionId,
    userId: claim.userId,
    gameCartelaId: claim.gameCartelaId,
    status: claim.status,
    attemptNumber: claim.attemptNumber,
    checkedPattern: claim.checkedPattern,
    reason: claim.reason,
    failureCode: claim.failureCode,
    failureMessage: claim.failureMessage,
    receivedAt: claim.receivedAt,
    completedAt: claim.completedAt,
    durationMs: claim.durationMs,
    receiptBallLetter: claim.receiptBallLetter,
    receiptBallNumber: claim.receiptBallNumber,
    receiptCalledOrder: claim.receiptCalledOrder,
    calledNumbersCountAtReceipt: claim.calledNumbersCountAtReceipt,
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

export function serializeAdminBingoAttempt(claim: BingoClaimRecord) {
  const ball =
    claim.receiptBallLetter != null && claim.receiptBallNumber != null
      ? `${claim.receiptBallLetter}-${claim.receiptBallNumber}`
      : null;

  return {
    id: claim.id,
    claimAttemptId: claim.claimAttemptId,
    gameSessionId: claim.gameSessionId,
    gameCartelaId: claim.gameCartelaId,
    userId: claim.userId,
    attemptNumber: claim.attemptNumber,
    status: claim.status,
    receivedAt: claim.receivedAt.toISOString(),
    completedAt: claim.completedAt?.toISOString() ?? null,
    durationMs: claim.durationMs,
    ballAtReceipt: ball,
    receiptBallLetter: claim.receiptBallLetter,
    receiptBallNumber: claim.receiptBallNumber,
    receiptCalledOrder: claim.receiptCalledOrder,
    calledNumbersCountAtReceipt: claim.calledNumbersCountAtReceipt,
    reasonCode: claim.reasonCode,
    reason: claim.reason,
    failureCode: claim.failureCode,
    failureMessage: claim.failureMessage,
    checkedPattern: claim.checkedPattern,
    user: claim.user,
    cartelaNumber: claim.gameCartela.cartela.number,
    gameCartelaStatus: claim.gameCartela.status,
  };
}
