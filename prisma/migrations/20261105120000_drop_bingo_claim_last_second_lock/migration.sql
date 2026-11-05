-- The last-second Bingo lock admin toggle was removed. IF EXISTS keeps this safe
-- whether or not 20261104120000_bingo_claim_last_second_lock was ever applied.
ALTER TABLE "AppDisplayConfig"
DROP COLUMN IF EXISTS "bingoClaimLastSecondLockEnabled";
