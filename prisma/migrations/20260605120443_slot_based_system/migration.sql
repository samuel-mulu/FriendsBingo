-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PLAYER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('NEXT', 'CHECKING', 'PLAYING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameCartelaStatus" AS ENUM ('REGISTERED', 'WINNER', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BingoClaimStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAW_REQUEST', 'WITHDRAW_PAID', 'WITHDRAW_REFUND', 'GAME_ENTRY', 'PRIZE_WIN', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'VERIFYING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('CBE', 'TELEBIRR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "password" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lockedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceBefore" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedData" JSONB,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiverPhone" TEXT,
    "receiverAccount" TEXT,
    "payoutRef" TEXT,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "patterns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSlot" (
    "id" TEXT NOT NULL,
    "staticCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "gameRuleId" TEXT,
    "status" "GameStatus" NOT NULL DEFAULT 'NEXT',
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "gameSlotId" TEXT NOT NULL,
    "playCode" TEXT NOT NULL,
    "entryFee" DECIMAL(12,2) NOT NULL,
    "prizeAmount" DECIMAL(12,2) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'PLAYING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "winnerCartelaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cartela" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "b" JSONB NOT NULL,
    "i" JSONB NOT NULL,
    "n" JSONB NOT NULL,
    "g" JSONB NOT NULL,
    "o" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cartela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameCartela" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartelaId" TEXT NOT NULL,
    "status" "GameCartelaStatus" NOT NULL DEFAULT 'REGISTERED',
    "markedCells" JSONB,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameCartela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalledNumber" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalledNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BingoClaim" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameCartelaId" TEXT NOT NULL,
    "status" "BingoClaimStatus" NOT NULL DEFAULT 'PENDING',
    "checkedPattern" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "BingoClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_idx" ON "WalletTransaction"("type");

-- CreateIndex
CREATE INDEX "WalletTransaction_referenceType_referenceId_idx" ON "WalletTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "WalletTransaction_createdAt_idx" ON "WalletTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_transactionRef_key" ON "Deposit"("transactionRef");

-- CreateIndex
CREATE INDEX "Deposit_userId_idx" ON "Deposit"("userId");

-- CreateIndex
CREATE INDEX "Deposit_provider_idx" ON "Deposit"("provider");

-- CreateIndex
CREATE INDEX "Deposit_status_idx" ON "Deposit"("status");

-- CreateIndex
CREATE INDEX "Deposit_createdAt_idx" ON "Deposit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_payoutRef_key" ON "Withdrawal"("payoutRef");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_idx" ON "Withdrawal"("userId");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- CreateIndex
CREATE INDEX "Withdrawal_createdAt_idx" ON "Withdrawal"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameRule_key_key" ON "GameRule"("key");

-- CreateIndex
CREATE INDEX "GameRule_isActive_idx" ON "GameRule"("isActive");

-- CreateIndex
CREATE INDEX "GameRule_sortOrder_idx" ON "GameRule"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GameSlot_staticCode_key" ON "GameSlot"("staticCode");

-- CreateIndex
CREATE INDEX "GameSlot_staticCode_idx" ON "GameSlot"("staticCode");

-- CreateIndex
CREATE INDEX "GameSlot_gameRuleId_idx" ON "GameSlot"("gameRuleId");

-- CreateIndex
CREATE INDEX "GameSlot_status_idx" ON "GameSlot"("status");

-- CreateIndex
CREATE INDEX "GameSlot_sortOrder_idx" ON "GameSlot"("sortOrder");

-- CreateIndex
CREATE INDEX "GameSlot_createdAt_idx" ON "GameSlot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_playCode_key" ON "GameSession"("playCode");

-- CreateIndex
CREATE INDEX "GameSession_gameSlotId_idx" ON "GameSession"("gameSlotId");

-- CreateIndex
CREATE INDEX "GameSession_playCode_idx" ON "GameSession"("playCode");

-- CreateIndex
CREATE INDEX "GameSession_status_idx" ON "GameSession"("status");

-- CreateIndex
CREATE INDEX "GameSession_createdAt_idx" ON "GameSession"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cartela_number_key" ON "Cartela"("number");

-- CreateIndex
CREATE INDEX "GameCartela_gameSessionId_idx" ON "GameCartela"("gameSessionId");

-- CreateIndex
CREATE INDEX "GameCartela_userId_idx" ON "GameCartela"("userId");

-- CreateIndex
CREATE INDEX "GameCartela_status_idx" ON "GameCartela"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameCartela_gameSessionId_userId_cartelaId_key" ON "GameCartela"("gameSessionId", "userId", "cartelaId");

-- CreateIndex
CREATE UNIQUE INDEX "GameCartela_gameSessionId_cartelaId_key" ON "GameCartela"("gameSessionId", "cartelaId");

-- CreateIndex
CREATE INDEX "CalledNumber_gameSessionId_idx" ON "CalledNumber"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CalledNumber_gameSessionId_number_key" ON "CalledNumber"("gameSessionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CalledNumber_gameSessionId_order_key" ON "CalledNumber"("gameSessionId", "order");

-- CreateIndex
CREATE INDEX "BingoClaim_gameSessionId_idx" ON "BingoClaim"("gameSessionId");

-- CreateIndex
CREATE INDEX "BingoClaim_userId_idx" ON "BingoClaim"("userId");

-- CreateIndex
CREATE INDEX "BingoClaim_status_idx" ON "BingoClaim"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSlot" ADD CONSTRAINT "GameSlot_gameRuleId_fkey" FOREIGN KEY ("gameRuleId") REFERENCES "GameRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_gameSlotId_fkey" FOREIGN KEY ("gameSlotId") REFERENCES "GameSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCartela" ADD CONSTRAINT "GameCartela_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCartela" ADD CONSTRAINT "GameCartela_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCartela" ADD CONSTRAINT "GameCartela_cartelaId_fkey" FOREIGN KEY ("cartelaId") REFERENCES "Cartela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalledNumber" ADD CONSTRAINT "CalledNumber_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BingoClaim" ADD CONSTRAINT "BingoClaim_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BingoClaim" ADD CONSTRAINT "BingoClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BingoClaim" ADD CONSTRAINT "BingoClaim_gameCartelaId_fkey" FOREIGN KEY ("gameCartelaId") REFERENCES "GameCartela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
