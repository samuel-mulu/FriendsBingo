-- Align auto-call interval default with code fallback (18s).
ALTER TABLE "GameTimingConfig" ALTER COLUMN "autoCallIntervalSeconds" SET DEFAULT 18;

-- Upgrade the seeded singleton row only when it still matches the prior factory default.
UPDATE "GameTimingConfig"
SET
  "autoCallIntervalSeconds" = 18,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "autoCallIntervalSeconds" = 15;
