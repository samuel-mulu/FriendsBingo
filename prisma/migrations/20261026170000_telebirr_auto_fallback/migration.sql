-- Add LOCAL_WITH_FALLBACK to DepositApprovalMode enum
ALTER TYPE "DepositApprovalMode" ADD VALUE IF NOT EXISTS 'LOCAL_WITH_FALLBACK';

-- Add circuit breaker configuration and state columns to DepositApprovalConfig
ALTER TABLE "DepositApprovalConfig"
ADD COLUMN IF NOT EXISTS "fallbackThreshold" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS "fallbackWindowMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "fallbackDurationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS "fallbackUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "fallbackReason" TEXT;

-- Create DepositCircuitBreakerFailure table
CREATE TABLE IF NOT EXISTS "DepositCircuitBreakerFailure" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "transactionRef" TEXT,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositCircuitBreakerFailure_pkey" PRIMARY KEY ("id")
);

-- Index for querying failures within rolling window
CREATE INDEX IF NOT EXISTS "DepositCircuitBreakerFailure_provider_createdAt_idx" ON "DepositCircuitBreakerFailure"("provider", "createdAt");
