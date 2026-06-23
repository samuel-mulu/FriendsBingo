-- Deposit verification migration: simplify statuses, add audit fields, full unique on provider+ref

UPDATE "Deposit"
SET "status" = 'PENDING'
WHERE "status" IN ('VERIFYING', 'MANUAL_REVIEW');

-- Keep earliest deposit per provider+transactionRef before adding full unique constraint
DELETE FROM "Deposit" AS d
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY provider, "transactionRef"
        ORDER BY "createdAt" ASC, id ASC
      ) AS row_num
    FROM "Deposit"
  ) ranked
  WHERE ranked.row_num > 1
) duplicates
WHERE d.id = duplicates.id;

DROP INDEX IF EXISTS "Deposit_provider_transactionRef_approved_key";
DROP INDEX IF EXISTS "Deposit_provider_transactionRef_key";

ALTER TABLE "Deposit"
  ADD COLUMN IF NOT EXISTS "verifyEtRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "verifyEtRawResponse" JSONB,
  ADD COLUMN IF NOT EXISTS "verifiedAmount" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "verifiedReceiverName" TEXT;

CREATE TYPE "DepositStatus_new" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Deposit"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Deposit"
  ALTER COLUMN "status" TYPE "DepositStatus_new"
  USING (
    CASE
      WHEN "status"::text IN ('VERIFYING', 'MANUAL_REVIEW') THEN 'PENDING'
      ELSE "status"::text
    END
  )::"DepositStatus_new";

ALTER TABLE "Deposit"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "DepositStatus";
ALTER TYPE "DepositStatus_new" RENAME TO "DepositStatus";

CREATE UNIQUE INDEX "Deposit_provider_transactionRef_key"
  ON "Deposit"("provider", "transactionRef");
