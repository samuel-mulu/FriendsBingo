-- AlterEnum GameCategory
ALTER TYPE "GameCategory" ADD VALUE IF NOT EXISTS 'CHAIN_GAME';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ChainRoundOutcome" AS ENUM ('WON', 'FORFEITED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable GameSession
ALTER TABLE "GameSession" ADD COLUMN IF NOT EXISTS "roundPausedUntil" TIMESTAMP(3);
ALTER TABLE "GameSession" ADD COLUMN IF NOT EXISTS "roundPrizeAmount" DECIMAL(12,2);

CREATE INDEX IF NOT EXISTS "GameSession_status_roundPausedUntil_idx" ON "GameSession"("status", "roundPausedUntil");

-- CreateTable GameSessionRoundResult
CREATE TABLE IF NOT EXISTS "GameSessionRoundResult" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "roundIndex" INTEGER NOT NULL,
    "gameRuleId" TEXT,
    "prizeAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "outcome" "ChainRoundOutcome" NOT NULL DEFAULT 'WON',
    "winningBallLetter" TEXT,
    "winningBallNumber" INTEGER,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSessionRoundResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameSessionRoundResult_gameSessionId_roundIndex_key" ON "GameSessionRoundResult"("gameSessionId", "roundIndex");
CREATE INDEX IF NOT EXISTS "GameSessionRoundResult_gameSessionId_idx" ON "GameSessionRoundResult"("gameSessionId");
CREATE INDEX IF NOT EXISTS "GameSessionRoundResult_gameRuleId_idx" ON "GameSessionRoundResult"("gameRuleId");
CREATE INDEX IF NOT EXISTS "GameSessionRoundResult_outcome_idx" ON "GameSessionRoundResult"("outcome");
CREATE INDEX IF NOT EXISTS "GameSessionRoundResult_finalizedAt_idx" ON "GameSessionRoundResult"("finalizedAt");

-- CreateTable GameSessionRoundWinner
CREATE TABLE IF NOT EXISTS "GameSessionRoundWinner" (
    "id" TEXT NOT NULL,
    "roundResultId" TEXT NOT NULL,
    "gameCartelaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartelaNumber" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSessionRoundWinner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameSessionRoundWinner_roundResultId_gameCartelaId_key" ON "GameSessionRoundWinner"("roundResultId", "gameCartelaId");
CREATE INDEX IF NOT EXISTS "GameSessionRoundWinner_roundResultId_idx" ON "GameSessionRoundWinner"("roundResultId");
CREATE INDEX IF NOT EXISTS "GameSessionRoundWinner_gameCartelaId_idx" ON "GameSessionRoundWinner"("gameCartelaId");
CREATE INDEX IF NOT EXISTS "GameSessionRoundWinner_userId_idx" ON "GameSessionRoundWinner"("userId");

-- FKs
DO $$ BEGIN
  ALTER TABLE "GameSessionRoundResult" ADD CONSTRAINT "GameSessionRoundResult_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameSessionRoundResult" ADD CONSTRAINT "GameSessionRoundResult_gameRuleId_fkey" FOREIGN KEY ("gameRuleId") REFERENCES "GameRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameSessionRoundWinner" ADD CONSTRAINT "GameSessionRoundWinner_roundResultId_fkey" FOREIGN KEY ("roundResultId") REFERENCES "GameSessionRoundResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameSessionRoundWinner" ADD CONSTRAINT "GameSessionRoundWinner_gameCartelaId_fkey" FOREIGN KEY ("gameCartelaId") REFERENCES "GameCartela"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameSessionRoundWinner" ADD CONSTRAINT "GameSessionRoundWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
