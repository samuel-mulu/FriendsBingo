ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'WINNER_WINDOW';

ALTER TABLE "GameSession"
ADD COLUMN IF NOT EXISTS "winnerWindowStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "winnerWindowEndsAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "prizeFinalizedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GameSession_winner_window_idx"
ON "GameSession"("status", "winnerWindowEndsAt", "prizeFinalizedAt");
