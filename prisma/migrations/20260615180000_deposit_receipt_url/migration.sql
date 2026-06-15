-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN "receiptUrl" TEXT;
ALTER TABLE "Deposit" ADD COLUMN "walletTransactionId" TEXT;

-- DropIndex
DROP INDEX IF EXISTS "Deposit_transactionRef_key";

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_provider_transactionRef_key" ON "Deposit"("provider", "transactionRef");
CREATE INDEX "Deposit_walletTransactionId_idx" ON "Deposit"("walletTransactionId");
