-- CreateEnum
CREATE TYPE "DepositVerificationAttemptStatus" AS ENUM (
  'SUBMITTING',
  'AWAITING_PROVIDER',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'AMBIGUOUS'
);

-- CreateTable
CREATE TABLE "DepositVerificationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "status" "DepositVerificationAttemptStatus" NOT NULL DEFAULT 'SUBMITTING',
    "providerRequestId" TEXT,
    "idempotencyKeyFingerprint" TEXT,
    "settlementCandidateIndex" INTEGER,
    "settlementAccountLast4" TEXT,
    "correlationId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "depositId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- One active automatic verification per provider+reference (any user).
CREATE UNIQUE INDEX "DepositVerificationAttempt_provider_transactionRef_active_key"
ON "DepositVerificationAttempt" ("provider", "transactionRef")
WHERE status IN ('SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS');

CREATE INDEX "DepositVerificationAttempt_userId_provider_transactionRef_idx"
ON "DepositVerificationAttempt" ("userId", "provider", "transactionRef");

CREATE INDEX "DepositVerificationAttempt_provider_transactionRef_status_idx"
ON "DepositVerificationAttempt" ("provider", "transactionRef", "status");

CREATE INDEX "DepositVerificationAttempt_providerRequestId_idx"
ON "DepositVerificationAttempt" ("providerRequestId");

CREATE INDEX "DepositVerificationAttempt_expiresAt_idx"
ON "DepositVerificationAttempt" ("expiresAt");

CREATE INDEX "DepositVerificationAttempt_status_updatedAt_idx"
ON "DepositVerificationAttempt" ("status", "updatedAt");

ALTER TABLE "DepositVerificationAttempt"
ADD CONSTRAINT "DepositVerificationAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
