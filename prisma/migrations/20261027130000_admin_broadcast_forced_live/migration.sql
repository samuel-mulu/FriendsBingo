-- AlterTable
ALTER TABLE "AdminBroadcast" ADD COLUMN "forcedLive" BOOLEAN NOT NULL DEFAULT false;

-- Existing forced rows were always live for players when present.
UPDATE "AdminBroadcast"
SET "forcedLive" = true
WHERE "category" = 'FORCED'
  AND "id" = (
    SELECT "id"
    FROM "AdminBroadcast"
    WHERE "category" = 'FORCED'
    ORDER BY "createdAt" DESC
    LIMIT 1
  );

-- At most one live forced broadcast at a time.
CREATE UNIQUE INDEX "AdminBroadcast_single_live_forced_idx"
ON "AdminBroadcast" ((1))
WHERE "category" = 'FORCED' AND "forcedLive" = true;
