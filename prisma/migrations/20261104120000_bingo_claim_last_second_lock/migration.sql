ALTER TABLE "AppDisplayConfig"
ADD COLUMN IF NOT EXISTS "bingoClaimLastSecondLockEnabled" BOOLEAN NOT NULL DEFAULT false;
