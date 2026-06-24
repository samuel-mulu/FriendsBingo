CREATE INDEX "GameSlot_status_sortOrder_idx"
ON "GameSlot"("status", "sortOrder");

CREATE INDEX "GameSession_status_finishedAt_idx"
ON "GameSession"("status", "finishedAt");

CREATE INDEX "Deposit_userId_createdAt_idx"
ON "Deposit"("userId", "createdAt");

CREATE INDEX "Withdrawal_userId_createdAt_idx"
ON "Withdrawal"("userId", "createdAt");

CREATE INDEX "GameCartelaReservation_gameSessionId_status_expiresAt_idx"
ON "GameCartelaReservation"("gameSessionId", "status", "expiresAt");
