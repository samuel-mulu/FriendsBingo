-- Per-round Big Game rules: slot config array + session-materialized rule.
ALTER TABLE "GameSlot" ADD COLUMN IF NOT EXISTS "roundGameRuleIds" JSONB;

ALTER TABLE "GameSession" ADD COLUMN IF NOT EXISTS "gameRuleId" TEXT;

CREATE INDEX IF NOT EXISTS "GameSession_gameRuleId_idx" ON "GameSession"("gameRuleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GameSession_gameRuleId_fkey'
  ) THEN
    ALTER TABLE "GameSession"
      ADD CONSTRAINT "GameSession_gameRuleId_fkey"
      FOREIGN KEY ("gameRuleId") REFERENCES "GameRule"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
