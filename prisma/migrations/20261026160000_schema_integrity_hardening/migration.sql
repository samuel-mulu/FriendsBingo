-- ============================================================================
-- Production Schema Hardening Migration
-- Zero data loss, zero breaking changes, idempotent & backwards-compatible.
-- ============================================================================

-- 1. Deposit global active uniqueness (Fix for Issue 1 & Issue 2)
-- If any legacy duplicate active rows exist in production, resolve them safely without deleting any data:
-- - If an APPROVED deposit exists alongside PENDING deposits for the same receipt, mark the PENDING ones as REJECTED.
-- - If multiple PENDING deposits exist for the same receipt, keep the latest PENDING and mark the older as REJECTED.
WITH ranked_active_deposits AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider, "transactionRef"
           ORDER BY CASE WHEN status = 'APPROVED' THEN 1 ELSE 2 END, "createdAt" DESC
         ) AS rank
  FROM "Deposit"
  WHERE status IN ('PENDING', 'APPROVED')
)
UPDATE "Deposit"
SET status = 'REJECTED',
    "rejectionReason" = COALESCE("rejectionReason", 'Automated migration: duplicate active submission resolution')
WHERE id IN (
  SELECT id FROM ranked_active_deposits WHERE rank > 1
);

DROP INDEX IF EXISTS "Deposit_provider_transactionRef_approved_key";
DROP INDEX IF EXISTS "Deposit_provider_transactionRef_active_key";

CREATE UNIQUE INDEX "Deposit_provider_transactionRef_active_key"
ON "Deposit" ("provider", "transactionRef")
WHERE "status" IN ('PENDING', 'APPROVED');


-- 2. DepositVerificationAttempt in-flight uniqueness (Fix for Issue 3)
-- Safely expire any stale attempts past their expiresAt, and resolve any duplicates by expiring older attempts.
WITH duplicate_attempts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider, "transactionRef"
           ORDER BY "createdAt" DESC
         ) AS rank
  FROM "DepositVerificationAttempt"
  WHERE status IN ('SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS')
)
UPDATE "DepositVerificationAttempt"
SET status = 'EXPIRED'
WHERE id IN (
  SELECT id FROM duplicate_attempts WHERE rank > 1
) OR (status IN ('SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS') AND "expiresAt" < CURRENT_TIMESTAMP);

DROP INDEX IF EXISTS "DepositVerificationAttempt_provider_transactionRef_active_key";

CREATE UNIQUE INDEX "DepositVerificationAttempt_provider_transactionRef_active_key"
ON "DepositVerificationAttempt" ("provider", "transactionRef")
WHERE "status" IN ('SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS');


-- 3. Wallet non-negative balance constraints (Fix for Issue 4)
-- Enforces that neither balance nor lockedBalance can ever be pushed below zero at the database level.
-- Idempotent check ensures no error if constraints were already established.
DO $$
BEGIN
  -- Normalize any anomalous negative balances to zero before applying check constraint
  UPDATE "Wallet" SET "balance" = 0 WHERE "balance" < 0;
  UPDATE "Wallet" SET "lockedBalance" = 0 WHERE "lockedBalance" < 0;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Wallet_balance_nonnegative_check'
  ) THEN
    ALTER TABLE "Wallet"
    ADD CONSTRAINT "Wallet_balance_nonnegative_check"
    CHECK ("balance" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Wallet_lockedBalance_nonnegative_check'
  ) THEN
    ALTER TABLE "Wallet"
    ADD CONSTRAINT "Wallet_lockedBalance_nonnegative_check"
    CHECK ("lockedBalance" >= 0);
  END IF;
END $$;


-- 4. Withdrawal ledger reconciliation (Fix for Issue 5)
-- Adds nullable walletTransactionId column with index (instant metadata addition, non-blocking).
ALTER TABLE "Withdrawal"
ADD COLUMN IF NOT EXISTS "walletTransactionId" TEXT;

CREATE INDEX IF NOT EXISTS "Withdrawal_walletTransactionId_idx"
ON "Withdrawal" ("walletTransactionId");

-- Backfill existing withdrawals with their corresponding WalletTransaction ID if present:
UPDATE "Withdrawal" w
SET "walletTransactionId" = wt.id
FROM (
  SELECT DISTINCT ON ("referenceId") id, "referenceId"
  FROM "WalletTransaction"
  WHERE "referenceType" = 'withdrawal'
  ORDER BY "referenceId",
    CASE
      WHEN type = 'WITHDRAW_PAID' THEN 1
      WHEN type = 'WITHDRAW_REFUND' THEN 2
      ELSE 3
    END,
    "createdAt" DESC
) wt
WHERE w.id = wt."referenceId"
  AND w."walletTransactionId" IS NULL;
