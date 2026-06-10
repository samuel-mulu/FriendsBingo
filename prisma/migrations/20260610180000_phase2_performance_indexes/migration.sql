CREATE INDEX IF NOT EXISTS "GameCartela_gameSessionId_status_idx"
ON "GameCartela"("gameSessionId", "status");

CREATE INDEX IF NOT EXISTS "BingoClaim_gameSessionId_status_idx"
ON "BingoClaim"("gameSessionId", "status");

CREATE INDEX IF NOT EXISTS "BingoClaim_gameSessionId_gameCartelaId_status_idx"
ON "BingoClaim"("gameSessionId", "gameCartelaId", "status");
