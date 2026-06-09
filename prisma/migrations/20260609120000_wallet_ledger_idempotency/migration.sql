-- Backfill legacy GAME_ENTRY rows keyed by SESSION so each cartela has its own ledger key.
WITH ranked_entries AS (
  SELECT
    wt.id,
    wt."userId",
    wt."referenceId" AS session_id,
    ROW_NUMBER() OVER (
      PARTITION BY wt."userId", wt."referenceId"
      ORDER BY wt."createdAt", wt.id
    ) AS rn
  FROM "WalletTransaction" wt
  WHERE wt.type = 'GAME_ENTRY'
    AND wt."referenceType" = 'SESSION'
    AND wt."referenceId" IS NOT NULL
),
ranked_cartelas AS (
  SELECT
    gc.id AS cartela_id,
    gc."userId",
    gc."gameSessionId",
    ROW_NUMBER() OVER (
      PARTITION BY gc."userId", gc."gameSessionId"
      ORDER BY gc."createdAt", gc.id
    ) AS rn
  FROM "GameCartela" gc
)
UPDATE "WalletTransaction" wt
SET
  "referenceType" = 'GAME_CARTELA',
  "referenceId" = rc.cartela_id
FROM ranked_entries re
JOIN ranked_cartelas rc
  ON re."userId" = rc."userId"
 AND re.session_id = rc."gameSessionId"
 AND re.rn = rc.rn
WHERE wt.id = re.id;

-- Backfill legacy PRIZE_WIN rows keyed by SESSION to winner cartelas where possible.
WITH ranked_prizes AS (
  SELECT
    wt.id,
    wt."userId",
    wt."referenceId" AS session_id,
    ROW_NUMBER() OVER (
      PARTITION BY wt."userId", wt."referenceId"
      ORDER BY wt."createdAt", wt.id
    ) AS rn
  FROM "WalletTransaction" wt
  WHERE wt.type = 'PRIZE_WIN'
    AND wt."referenceType" = 'SESSION'
    AND wt."referenceId" IS NOT NULL
),
ranked_winners AS (
  SELECT
    gc.id AS cartela_id,
    gc."userId",
    gc."gameSessionId",
    ROW_NUMBER() OVER (
      PARTITION BY gc."userId", gc."gameSessionId"
      ORDER BY gc."createdAt", gc.id
    ) AS rn
  FROM "GameCartela" gc
  WHERE gc."isWinner" = true
     OR gc.status = 'WINNER'
)
UPDATE "WalletTransaction" wt
SET
  "referenceType" = 'GAME_CARTELA',
  "referenceId" = rw.cartela_id
FROM ranked_prizes rp
JOIN ranked_winners rw
  ON rp."userId" = rw."userId"
 AND rp.session_id = rw."gameSessionId"
 AND rp.rn = rw.rn
WHERE wt.id = rp.id;

-- Any remaining duplicate business keys keep the oldest row and suffix the rest.
UPDATE "WalletTransaction" wt
SET "referenceId" = wt."referenceId" || ':' || wt.id
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "type", "referenceType", "referenceId"
      ORDER BY "createdAt", id
    ) AS rn
  FROM "WalletTransaction"
  WHERE "referenceType" IS NOT NULL
    AND "referenceId" IS NOT NULL
) AS duplicates
WHERE wt.id = duplicates.id
  AND duplicates.rn > 1;

-- Prevent duplicate wallet ledger entries for the same business action.
CREATE UNIQUE INDEX "WalletTransaction_userId_type_referenceType_referenceId_key"
ON "WalletTransaction"("userId", "type", "referenceType", "referenceId");
