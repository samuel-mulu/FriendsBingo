-- Drop global receipt unique so failed attempts do not block retries.
DROP INDEX IF EXISTS "Deposit_provider_transactionRef_key";

-- Only APPROVED deposits consume a receipt permanently.
CREATE UNIQUE INDEX "Deposit_provider_transactionRef_approved_key"
  ON "Deposit"("provider", "transactionRef")
  WHERE "status" = 'APPROVED';

-- Remove legacy failed Telebirr deposit rows that blocked retries.
DELETE FROM "Deposit"
WHERE "provider" = 'TELEBIRR'
  AND "status" <> 'APPROVED';
