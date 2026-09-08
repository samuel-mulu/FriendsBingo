-- AlterEnum CartelaPaymentSource
ALTER TYPE "CartelaPaymentSource" ADD VALUE IF NOT EXISTS 'BIG_GAME_TICKET';
ALTER TYPE "CartelaPaymentSource" ADD VALUE IF NOT EXISTS 'CARRIED_FORWARD';

-- CreateEnum
CREATE TYPE "BigGameTicketLedgerType" AS ENUM ('GRANT_FORCE', 'GRANT_ADMIN', 'SPEND_REGISTER', 'EXPIRE');

-- AlterTable GameSlot
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "roundCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "roundPrizes" JSONB;
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "interRoundDelaySeconds" INTEGER;
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "currentRound" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "forceBigGameEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "forceBigGameCartelaCount" INTEGER;

CREATE INDEX IF NOT EXISTS "GameSlot_category_status_idx" ON "GameSlot"("category", "status");

-- AlterTable GameSession
ALTER TABLE "GameSession" ADD COLUMN IF NOT EXISTS "nextRoundStartsAt" TIMESTAMP(3);
ALTER TABLE "GameSession" ADD COLUMN IF NOT EXISTS "roundIndex" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "GameSession_status_nextRoundStartsAt_idx" ON "GameSession"("status", "nextRoundStartsAt");
CREATE INDEX IF NOT EXISTS "GameSession_gameSlotId_roundIndex_idx" ON "GameSession"("gameSlotId", "roundIndex");

-- CreateTable BigGameTicketBalance
CREATE TABLE IF NOT EXISTS "BigGameTicketBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlotId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BigGameTicketBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BigGameTicketBalance_userId_gameSlotId_key" ON "BigGameTicketBalance"("userId", "gameSlotId");
CREATE INDEX IF NOT EXISTS "BigGameTicketBalance_gameSlotId_idx" ON "BigGameTicketBalance"("gameSlotId");
CREATE INDEX IF NOT EXISTS "BigGameTicketBalance_userId_idx" ON "BigGameTicketBalance"("userId");

-- CreateTable BigGameTicketLedger
CREATE TABLE IF NOT EXISTS "BigGameTicketLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlotId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "BigGameTicketLedgerType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BigGameTicketLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BigGameTicketLedger_userId_type_referenceType_referenceId_key" ON "BigGameTicketLedger"("userId", "type", "referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "BigGameTicketLedger_gameSlotId_userId_idx" ON "BigGameTicketLedger"("gameSlotId", "userId");
CREATE INDEX IF NOT EXISTS "BigGameTicketLedger_userId_createdAt_idx" ON "BigGameTicketLedger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BigGameTicketLedger_type_idx" ON "BigGameTicketLedger"("type");
CREATE INDEX IF NOT EXISTS "BigGameTicketLedger_referenceType_referenceId_idx" ON "BigGameTicketLedger"("referenceType", "referenceId");

-- FKs
DO $$ BEGIN
  ALTER TABLE "BigGameTicketBalance" ADD CONSTRAINT "BigGameTicketBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BigGameTicketBalance" ADD CONSTRAINT "BigGameTicketBalance_gameSlotId_fkey" FOREIGN KEY ("gameSlotId") REFERENCES "GameSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BigGameTicketLedger" ADD CONSTRAINT "BigGameTicketLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BigGameTicketLedger" ADD CONSTRAINT "BigGameTicketLedger_gameSlotId_fkey" FOREIGN KEY ("gameSlotId") REFERENCES "GameSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
