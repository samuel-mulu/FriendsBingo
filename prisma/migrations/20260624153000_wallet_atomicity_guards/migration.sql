CREATE INDEX "WalletTransaction_userId_createdAt_idx"
ON "WalletTransaction"("userId", "createdAt");

ALTER TABLE "Wallet"
ADD CONSTRAINT "Wallet_balance_nonnegative_check"
CHECK ("balance" >= 0);

ALTER TABLE "Wallet"
ADD CONSTRAINT "Wallet_lockedBalance_nonnegative_check"
CHECK ("lockedBalance" >= 0);
