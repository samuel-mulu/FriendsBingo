-- AlterEnum: additive BingoClaimStatus values
ALTER TYPE "BingoClaimStatus" ADD VALUE IF NOT EXISTS 'CHECKING';
ALTER TYPE "BingoClaimStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "BingoClaimStatus" ADD VALUE IF NOT EXISTS 'ALREADY_RESOLVED';

-- Additive columns (nullable first for backfill safety)
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "claimAttemptId" TEXT;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "failureMessage" TEXT;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "receiptBallLetter" TEXT;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "receiptBallNumber" INTEGER;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "receiptCalledOrder" INTEGER;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "calledNumbersCountAtReceipt" INTEGER;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "clientTapAt" TIMESTAMP(3);
ALTER TABLE "BingoClaim" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Backfill existing rows
UPDATE "BingoClaim"
SET "claimAttemptId" = "id"
WHERE "claimAttemptId" IS NULL;

UPDATE "BingoClaim"
SET "receivedAt" = "createdAt"
WHERE "receivedAt" IS NULL;

UPDATE "BingoClaim"
SET "updatedAt" = COALESCE("checkedAt", "createdAt")
WHERE "updatedAt" IS NULL;

UPDATE "BingoClaim"
SET "completedAt" = "checkedAt"
WHERE "completedAt" IS NULL
  AND "status" IN ('VALID', 'INVALID');

-- Enforce NOT NULL after backfill
ALTER TABLE "BingoClaim" ALTER COLUMN "claimAttemptId" SET NOT NULL;
ALTER TABLE "BingoClaim" ALTER COLUMN "receivedAt" SET NOT NULL;
ALTER TABLE "BingoClaim" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "BingoClaim" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Single unique constraint on claimAttemptId
CREATE UNIQUE INDEX IF NOT EXISTS "BingoClaim_claimAttemptId_key" ON "BingoClaim"("claimAttemptId");

-- Query indexes
CREATE INDEX IF NOT EXISTS "BingoClaim_gameSessionId_receivedAt_idx" ON "BingoClaim"("gameSessionId", "receivedAt");
CREATE INDEX IF NOT EXISTS "BingoClaim_gameCartelaId_receivedAt_idx" ON "BingoClaim"("gameCartelaId", "receivedAt");
CREATE INDEX IF NOT EXISTS "BingoClaim_userId_receivedAt_idx" ON "BingoClaim"("userId", "receivedAt");

-- One open AUTO CHECKING attempt per cartela (historical statuses allowed)
CREATE UNIQUE INDEX IF NOT EXISTS "BingoClaim_one_open_checking_per_cartela_idx"
ON "BingoClaim"("gameCartelaId")
WHERE "status" = 'CHECKING';
