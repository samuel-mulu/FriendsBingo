-- Deposit approval config per provider
CREATE TYPE "DepositApprovalMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'LOCAL');

CREATE TABLE "DepositApprovalConfig" (
    "provider" "PaymentProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalMode" "DepositApprovalMode" NOT NULL DEFAULT 'AUTOMATIC',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "DepositApprovalConfig_pkey" PRIMARY KEY ("provider")
);

INSERT INTO "DepositApprovalConfig" ("provider", "enabled", "approvalMode", "updatedAt")
VALUES
  ('TELEBIRR', true, 'AUTOMATIC', CURRENT_TIMESTAMP),
  ('CBE', true, 'AUTOMATIC', CURRENT_TIMESTAMP),
  ('AWASH', true, 'AUTOMATIC', CURRENT_TIMESTAMP),
  ('BOA', true, 'AUTOMATIC', CURRENT_TIMESTAMP);

-- Allow rejected refs to be resubmitted; only one active claim per ref
DROP INDEX IF EXISTS "Deposit_provider_transactionRef_key";

CREATE UNIQUE INDEX "Deposit_provider_transactionRef_active_key"
ON "Deposit" ("provider", "transactionRef")
WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX "Deposit_provider_transactionRef_status_idx"
ON "Deposit" ("provider", "transactionRef", "status");
