-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'REGISTRATION_CASHBACK';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lifetimeQualifyingRegistrationCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RegistrationCashbackConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "tiers" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationCashbackConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationCashbackAccrual" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qualifyingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationCashbackAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationCashbackGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "gameSlotCategory" "GameCategory" NOT NULL,
    "sessionQualifyingCountAtGrant" INTEGER NOT NULL,
    "lifetimeQualifyingCountAtGrant" INTEGER NOT NULL,
    "tierMinCartelas" INTEGER NOT NULL,
    "rewardEtb" DECIMAL(12,2) NOT NULL,
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationCashbackGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCashbackAccrual_gameSessionId_userId_key" ON "RegistrationCashbackAccrual"("gameSessionId", "userId");

-- CreateIndex
CREATE INDEX "RegistrationCashbackAccrual_gameSessionId_idx" ON "RegistrationCashbackAccrual"("gameSessionId");

-- CreateIndex
CREATE INDEX "RegistrationCashbackAccrual_userId_idx" ON "RegistrationCashbackAccrual"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCashbackGrant_userId_gameSessionId_key" ON "RegistrationCashbackGrant"("userId", "gameSessionId");

-- CreateIndex
CREATE INDEX "RegistrationCashbackGrant_gameSessionId_idx" ON "RegistrationCashbackGrant"("gameSessionId");

-- CreateIndex
CREATE INDEX "RegistrationCashbackGrant_userId_idx" ON "RegistrationCashbackGrant"("userId");

-- CreateIndex
CREATE INDEX "RegistrationCashbackGrant_createdAt_idx" ON "RegistrationCashbackGrant"("createdAt");

-- AddForeignKey
ALTER TABLE "RegistrationCashbackConfig" ADD CONSTRAINT "RegistrationCashbackConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCashbackAccrual" ADD CONSTRAINT "RegistrationCashbackAccrual_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCashbackAccrual" ADD CONSTRAINT "RegistrationCashbackAccrual_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCashbackGrant" ADD CONSTRAINT "RegistrationCashbackGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCashbackGrant" ADD CONSTRAINT "RegistrationCashbackGrant_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default config (disabled, example tiers)
INSERT INTO "RegistrationCashbackConfig" ("id", "enabled", "tiers", "updatedAt")
VALUES (
  'default',
  false,
  '[{"minCartelasInSession":50,"rewardEtb":"10"},{"minCartelasInSession":70,"rewardEtb":"20"}]'::jsonb,
  CURRENT_TIMESTAMP
);
