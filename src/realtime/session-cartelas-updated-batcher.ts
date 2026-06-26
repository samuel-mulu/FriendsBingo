import type { SessionCartelaChange } from '../games/games.mapper';

export const SESSION_CARTELAS_BATCH_MS = 50;

export type SessionCartelasUpdatedEmitPayload = {
  sessionId: string;
  slotId: string;
  prizeAmount?: string;
  registeredCartelasCount?: number;
  changes?: SessionCartelaChange[];
};

type MutableBatch = {
  sessionId: string;
  slotId: string;
  prizeAmount?: string;
  registeredCartelasCount?: number;
  changesByCartelaId: Map<string, SessionCartelaChange>;
};

export function mergeCartelasUpdatedPayload(
  batch: MutableBatch,
  payload: SessionCartelasUpdatedEmitPayload,
): void {
  batch.slotId = payload.slotId;

  if (payload.prizeAmount !== undefined) {
    batch.prizeAmount = payload.prizeAmount;
  }

  if (payload.registeredCartelasCount !== undefined) {
    batch.registeredCartelasCount = payload.registeredCartelasCount;
  }

  for (const change of payload.changes ?? []) {
    batch.changesByCartelaId.set(change.cartelaId, change);
  }
}

export function createCartelasUpdatedBatch(
  payload: SessionCartelasUpdatedEmitPayload,
): MutableBatch {
  const batch: MutableBatch = {
    sessionId: payload.sessionId,
    slotId: payload.slotId,
    changesByCartelaId: new Map(),
  };
  mergeCartelasUpdatedPayload(batch, payload);
  return batch;
}

export function buildSessionCartelasUpdatedPayload(
  batch: MutableBatch,
): SessionCartelasUpdatedEmitPayload {
  const changes = [...batch.changesByCartelaId.values()].sort(
    (left, right) => left.cartelaNumber - right.cartelaNumber,
  );

  return {
    sessionId: batch.sessionId,
    slotId: batch.slotId,
    ...(batch.prizeAmount !== undefined ? { prizeAmount: batch.prizeAmount } : {}),
    ...(batch.registeredCartelasCount !== undefined
      ? { registeredCartelasCount: batch.registeredCartelasCount }
      : {}),
    ...(changes.length > 0 ? { changes } : {}),
  };
}

export function buildPublicCartelasSummaryPayload(
  payload: SessionCartelasUpdatedEmitPayload,
): SessionCartelasUpdatedEmitPayload {
  return {
    sessionId: payload.sessionId,
    slotId: payload.slotId,
    ...(payload.prizeAmount !== undefined
      ? { prizeAmount: payload.prizeAmount }
      : {}),
    ...(payload.registeredCartelasCount !== undefined
      ? { registeredCartelasCount: payload.registeredCartelasCount }
      : {}),
  };
}
