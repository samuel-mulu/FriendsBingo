ALTER TABLE "GameSession"
ADD COLUMN "autoCallEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoCallIntervalMs" INTEGER NOT NULL DEFAULT 7000,
ADD COLUMN "nextAutoCallAt" TIMESTAMP(3);

CREATE INDEX "GameSession_autoCallEnabled_status_nextAutoCallAt_idx"
ON "GameSession"("autoCallEnabled", "status", "nextAutoCallAt");
