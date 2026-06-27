ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'NO_WINNER';

ALTER TABLE "GameSession"
ADD COLUMN "noWinnerGraceEndsAt" TIMESTAMP(3),
ADD COLUMN "noWinnerReason" TEXT;

CREATE INDEX "GameSession_status_noWinnerGraceEndsAt_idx"
ON "GameSession"("status", "noWinnerGraceEndsAt");
