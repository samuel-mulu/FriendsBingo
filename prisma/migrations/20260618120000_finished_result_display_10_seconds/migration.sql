-- Give players more time to read finished-game results (name, prize, winners).
ALTER TABLE "GameTimingConfig" ALTER COLUMN "finishedResultDisplaySeconds" SET DEFAULT 10;
ALTER TABLE "GameTimingConfig" ALTER COLUMN "winningPatternDisplaySeconds" SET DEFAULT 10;

-- Upgrade the seeded singleton row only when it still matches the original factory values.
UPDATE "GameTimingConfig"
SET
  "finishedResultDisplaySeconds" = 10,
  "winningPatternDisplaySeconds" = 10,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "finishedResultDisplaySeconds" = 3
  AND "winningPatternDisplaySeconds" = 8;
