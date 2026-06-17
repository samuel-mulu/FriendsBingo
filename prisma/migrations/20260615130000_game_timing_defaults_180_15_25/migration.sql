-- Align column defaults with code fallbacks (3 min registration, 15s auto-call, 25s winner window).
ALTER TABLE "GameTimingConfig" ALTER COLUMN "registrationDurationSeconds" SET DEFAULT 180;
ALTER TABLE "GameTimingConfig" ALTER COLUMN "autoCallIntervalSeconds" SET DEFAULT 15;
ALTER TABLE "GameTimingConfig" ALTER COLUMN "winnerWindowSeconds" SET DEFAULT 25;

-- Upgrade the seeded singleton row only when it still matches the original factory values.
UPDATE "GameTimingConfig"
SET
  "registrationDurationSeconds" = 180,
  "autoCallIntervalSeconds" = 15,
  "winnerWindowSeconds" = 25,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "registrationDurationSeconds" = 60
  AND "autoCallIntervalSeconds" = 7
  AND "winnerWindowSeconds" = 15;
