-- =============================================================================
-- FORENSIC AUDIT: player phone 251914407635 (ቆንጆ)
-- Run on PRODUCTION only (read-only). Paste into:
--   docker compose exec postgres psql -U gameuser -d gamedb
-- Or:  \i /path/to/player-251914407635-audit.sql
-- =============================================================================
-- HOW TO USE
-- 1) Run SECTION 0 first — confirm the user id.
-- 2) Run each section A → H in order. Copy results to a notes file.
-- 3) Do not change gameplay / schema while investigating.
-- =============================================================================

\pset pager off
\timing on

-- -----------------------------------------------------------------------------
-- SECTION 0 — Resolve player
-- -----------------------------------------------------------------------------
\echo '========== SECTION 0: RESOLVE PLAYER =========='

SELECT id, "fullName", "phoneNumber", role, status, "createdAt", "updatedAt"
FROM "User"
WHERE "phoneNumber" IN ('251914407635', '0914407635', '914407635', '+251914407635');

-- Bind once (psql). If multiple rows, stop and pick the correct id.
SELECT id AS suspect_user_id
FROM "User"
WHERE "phoneNumber" = '251914407635'
\gset

\echo 'suspect_user_id =' :'suspect_user_id'

-- =============================================================================
-- A. Account timeline
-- =============================================================================
\echo '========== A1: ACCOUNT PROFILE =========='

SELECT
  u.id,
  u."fullName",
  u."phoneNumber",
  u.role,
  u.status,
  u."createdAt" AS account_created,
  u."updatedAt" AS profile_updated,
  w.balance,
  w."lockedBalance",
  w."bonusCartelaBalance"
FROM "User" u
LEFT JOIN "Wallet" w ON w."userId" = u.id
WHERE u.id = :'suspect_user_id';

\echo '========== A2: WELCOME BONUS / DEVICE =========='

SELECT *
FROM "DeviceWelcomeBonusGrant"
WHERE "userId" = :'suspect_user_id'
   OR "phoneNumber" IN ('251914407635', '0914407635');

\echo '========== A3: PUSH DEVICES =========='

SELECT id, platform, enabled, "lastSeenAt", "createdAt",
       LEFT("fcmToken", 12) AS fcm_prefix
FROM "PushDevice"
WHERE "userId" = :'suspect_user_id'
ORDER BY "lastSeenAt" DESC;

\echo '========== A4: REFRESH TOKENS / DEVICE IDS =========='

SELECT id, "deviceId", "createdAt", "expiresAt", "revokedAt"
FROM "RefreshToken"
WHERE "userId" = :'suspect_user_id'
ORDER BY "createdAt" DESC
LIMIT 50;

\echo '========== A5: OTP CHALLENGES FOR THIS PHONE =========='

SELECT id, purpose, "requestIp", "deviceId", "attemptCount",
       "consumedAt", "expiresAt", "createdAt"
FROM "OtpChallenge"
WHERE "phoneNumber" IN ('251914407635', '0914407635', '+251914407635')
ORDER BY "createdAt" DESC
LIMIT 50;

\echo '========== A6: AUDIT LOGS WHERE ACTOR = THIS USER =========='

SELECT id, action, entity, "entityId", metadata, "createdAt"
FROM "AuditLog"
WHERE "actorId" = :'suspect_user_id'
ORDER BY "createdAt" DESC
LIMIT 100;

-- =============================================================================
-- B. Wallet timeline
-- =============================================================================
\echo '========== B1: WALLET SUMMARY =========='

SELECT
  type,
  COUNT(*) AS tx_count,
  SUM(amount)::numeric(14,2) AS total_amount,
  MIN("createdAt") AS first_at,
  MAX("createdAt") AS last_at
FROM "WalletTransaction"
WHERE "userId" = :'suspect_user_id'
GROUP BY type
ORDER BY total_amount DESC;

\echo '========== B2: FULL LEDGER (newest first) =========='

SELECT
  "createdAt",
  type,
  amount::numeric(14,2) AS amount,
  "balanceBefore"::numeric(14,2) AS bal_before,
  "balanceAfter"::numeric(14,2) AS bal_after,
  "referenceType",
  "referenceId",
  description
FROM "WalletTransaction"
WHERE "userId" = :'suspect_user_id'
ORDER BY "createdAt" DESC
LIMIT 300;

\echo '========== B3: DEPOSITS =========='

SELECT
  id, provider, amount::numeric(14,2) AS amount, status,
  "transactionRef", "verifiedAmount"::numeric(14,2) AS verified_amount,
  "createdAt", "verifiedAt", "rejectionReason"
FROM "Deposit"
WHERE "userId" = :'suspect_user_id'
ORDER BY "createdAt" DESC;

\echo '========== B4: WITHDRAWALS =========='

SELECT
  id, provider, amount::numeric(14,2) AS amount, status,
  "receiverPhone", "receiverAccount", "payoutRef",
  "adminNote", "createdAt", "updatedAt"
FROM "Withdrawal"
WHERE "userId" = :'suspect_user_id'
ORDER BY "createdAt" DESC;

\echo '========== B5: DEPOSIT vs WITHDRAW vs PRIZE =========='

SELECT
  COALESCE((
    SELECT SUM(amount)::numeric(14,2)
    FROM "Deposit"
    WHERE "userId" = :'suspect_user_id' AND status = 'APPROVED'
  ), 0) AS approved_deposits,
  COALESCE((
    SELECT SUM(amount)::numeric(14,2)
    FROM "Withdrawal"
    WHERE "userId" = :'suspect_user_id' AND status IN ('APPROVED', 'PAID')
  ), 0) AS approved_or_paid_withdrawals,
  COALESCE((
    SELECT SUM(amount)::numeric(14,2)
    FROM "WalletTransaction"
    WHERE "userId" = :'suspect_user_id' AND type = 'PRIZE_WIN'
  ), 0) AS prize_credits,
  COALESCE((
    SELECT SUM(ABS(amount))::numeric(14,2)
    FROM "WalletTransaction"
    WHERE "userId" = :'suspect_user_id' AND type = 'GAME_ENTRY'
  ), 0) AS game_entry_spend,
  COALESCE((
    SELECT SUM(amount)::numeric(14,2)
    FROM "WalletTransaction"
    WHERE "userId" = :'suspect_user_id' AND type = 'ADMIN_ADJUSTMENT'
  ), 0) AS admin_adjustments;

\echo '========== B6: LEDGER GAPS / DUPLICATE REFS =========='

SELECT "referenceType", "referenceId", type, COUNT(*) AS n
FROM "WalletTransaction"
WHERE "userId" = :'suspect_user_id'
  AND "referenceId" IS NOT NULL
GROUP BY "referenceType", "referenceId", type
HAVING COUNT(*) > 1;

-- =============================================================================
-- C. Game participation
-- =============================================================================
\echo '========== C1: EVERY JOINED FINISHED/NO_WINNER GAME =========='

WITH player_games AS (
  SELECT
    gc."gameSessionId",
    COUNT(*) AS player_cartelas,
    BOOL_OR(gc."isWinner") AS player_won,
    MIN(gc."createdAt") AS first_reg_at,
    MAX(gc."createdAt") AS last_reg_at
  FROM "GameCartela" gc
  WHERE gc."userId" = :'suspect_user_id'
    AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
  GROUP BY gc."gameSessionId"
)
SELECT
  gs.id AS session_id,
  gs."playCode",
  gs.status,
  gs."prizeAmount"::numeric(14,2) AS prize,
  slot.name AS slot_name,
  slot."gameType",
  slot.category,
  gr.key AS rule_key,
  pg.player_cartelas,
  (SELECT COUNT(*) FROM "GameCartela" x
    WHERE x."gameSessionId" = gs.id
      AND x.status IN ('REGISTERED', 'WINNER', 'BLOCKED')) AS total_cartelas,
  (SELECT COUNT(DISTINCT x."userId") FROM "GameCartela" x
    WHERE x."gameSessionId" = gs.id
      AND x.status IN ('REGISTERED', 'WINNER', 'BLOCKED')) AS total_players,
  ROUND(
    100.0 * pg.player_cartelas / NULLIF((
      SELECT COUNT(*) FROM "GameCartela" x
      WHERE x."gameSessionId" = gs.id
        AND x.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
    ), 0)
  , 2) AS player_share_pct,
  pg.player_won,
  pg.first_reg_at,
  pg.last_reg_at,
  gs."startedAt",
  gs."finishedAt"
FROM player_games pg
JOIN "GameSession" gs ON gs.id = pg."gameSessionId"
JOIN "GameSlot" slot ON slot.id = gs."gameSlotId"
LEFT JOIN "GameRule" gr ON gr.id = slot."gameRuleId"
WHERE gs.status IN ('FINISHED', 'NO_WINNER', 'CANCELLED')
ORDER BY gs."prizeAmount" DESC, gs."finishedAt" DESC NULLS LAST;

\echo '========== C2: LARGE PRIZE GAMES ONLY (prize >= 1000) =========='

WITH player_games AS (
  SELECT
    gc."gameSessionId",
    COUNT(*) AS player_cartelas,
    BOOL_OR(gc."isWinner") AS player_won
  FROM "GameCartela" gc
  WHERE gc."userId" = :'suspect_user_id'
    AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
  GROUP BY gc."gameSessionId"
)
SELECT
  gs.id AS session_id,
  gs."playCode",
  gs."prizeAmount"::numeric(14,2) AS prize,
  pg.player_cartelas,
  (SELECT COUNT(*) FROM "GameCartela" x
    WHERE x."gameSessionId" = gs.id
      AND x.status IN ('REGISTERED', 'WINNER', 'BLOCKED')) AS total_cartelas,
  ROUND(
    100.0 * pg.player_cartelas / NULLIF((
      SELECT COUNT(*) FROM "GameCartela" x
      WHERE x."gameSessionId" = gs.id
        AND x.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
    ), 0)
  , 2) AS player_share_pct,
  pg.player_won,
  gs."finishedAt"
FROM player_games pg
JOIN "GameSession" gs ON gs.id = pg."gameSessionId"
WHERE gs."prizeAmount" >= 1000
  AND gs.status IN ('FINISHED', 'NO_WINNER')
ORDER BY gs."prizeAmount" DESC, gs."finishedAt" DESC;

-- =============================================================================
-- D. Every win — deep dive
-- =============================================================================
\echo '========== D1: ALL WINS BY THIS PLAYER =========='

SELECT
  gs.id AS session_id,
  gs."playCode",
  gs."prizeAmount"::numeric(14,2) AS prize,
  gc.id AS game_cartela_id,
  c.number AS cartela_number,
  gc."isWinner",
  gc.status,
  bc.id AS claim_id,
  bc.status AS claim_status,
  bc."checkedPattern",
  bc."reasonCode",
  bc."winningBallLetter",
  bc."winningBallNumber",
  bc."createdAt" AS claim_created,
  bc."checkedAt" AS claim_checked,
  (SELECT COUNT(*) FROM "CalledNumber" cn WHERE cn."gameSessionId" = gs.id) AS total_calls,
  (SELECT cn."order" FROM "CalledNumber" cn
    WHERE cn."gameSessionId" = gs.id
      AND cn.letter = bc."winningBallLetter"
      AND cn.number = bc."winningBallNumber"
    LIMIT 1) AS winning_ball_order,
  gs."finishedAt"
FROM "GameCartela" gc
JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
JOIN "Cartela" c ON c.id = gc."cartelaId"
LEFT JOIN "BingoClaim" bc
  ON bc."gameCartelaId" = gc.id AND bc.status = 'VALID'
WHERE gc."userId" = :'suspect_user_id'
  AND (gc."isWinner" = true OR gc.status = 'WINNER' OR gs."winnerCartelaId" = gc.id)
ORDER BY gs."prizeAmount" DESC, gs."finishedAt" DESC;

\echo '========== D2: FOCUS — largest win session(s) call source =========='
-- Pick the biggest prize win automatically into :big_session_id

SELECT gs.id AS big_session_id
FROM "GameCartela" gc
JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
WHERE gc."userId" = :'suspect_user_id'
  AND (gc."isWinner" = true OR gc.status = 'WINNER' OR gs."winnerCartelaId" = gc.id)
ORDER BY gs."prizeAmount" DESC, gs."finishedAt" DESC
LIMIT 1
\gset

\echo 'big_session_id =' :'big_session_id'

\echo '========== D2a: SESSION SNAPSHOT =========='

SELECT
  gs.id, gs."playCode", gs.status, gs."prizeAmount"::numeric(14,2) AS prize,
  gs."autoCallEnabled", gs."autoCallIntervalMs",
  slot.name, slot."operationMode", slot.category, gr.key AS rule_key,
  gs."startedAt", gs."finishedAt",
  gs."winnerCartelaId",
  (SELECT COUNT(*) FROM "GameCartela" x WHERE x."gameSessionId" = gs.id) AS cartelas_rows,
  (SELECT COUNT(*) FROM "CalledNumber" cn WHERE cn."gameSessionId" = gs.id) AS called_count
FROM "GameSession" gs
JOIN "GameSlot" slot ON slot.id = gs."gameSlotId"
LEFT JOIN "GameRule" gr ON gr.id = slot."gameRuleId"
WHERE gs.id = :'big_session_id';

\echo '========== D2b: PLAYER CARDS IN THAT SESSION =========='

SELECT
  gc.id AS game_cartela_id,
  c.number AS cartela_number,
  gc.status,
  gc."isWinner",
  gc."createdAt" AS registered_at,
  gc."blockedAt",
  c.b, c.i, c.n, c.g, c.o
FROM "GameCartela" gc
JOIN "Cartela" c ON c.id = gc."cartelaId"
WHERE gc."gameSessionId" = :'big_session_id'
  AND gc."userId" = :'suspect_user_id'
ORDER BY c.number;

\echo '========== D2c: ALL PLAYERS SHARE IN THAT SESSION =========='

SELECT
  u."fullName",
  u."phoneNumber",
  COUNT(*) AS cartelas,
  BOOL_OR(gc."isWinner") AS won
FROM "GameCartela" gc
JOIN "User" u ON u.id = gc."userId"
WHERE gc."gameSessionId" = :'big_session_id'
  AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
GROUP BY u.id, u."fullName", u."phoneNumber"
ORDER BY cartelas DESC, won DESC;

\echo '========== D2d: CALLED NUMBERS + AUTO vs ADMIN =========='
-- ADMIN if matching AuditLog admin.game.call_number exists for session+number

SELECT
  cn."order",
  cn.letter,
  cn.number,
  cn."createdAt" AS called_at,
  CASE
    WHEN al.id IS NOT NULL THEN 'ADMIN'
    ELSE 'AUTO_OR_UNAUDITED'
  END AS call_source,
  al."actorId" AS admin_actor_id,
  actor."fullName" AS admin_name,
  actor."phoneNumber" AS admin_phone,
  al."createdAt" AS audit_at,
  al.metadata AS audit_metadata
FROM "CalledNumber" cn
LEFT JOIN "AuditLog" al
  ON al.action = 'admin.game.call_number'
 AND al.entity = 'CalledNumber'
 AND al."entityId" = cn.id
LEFT JOIN "User" actor ON actor.id = al."actorId"
WHERE cn."gameSessionId" = :'big_session_id'
ORDER BY cn."order";

\echo '========== D2d-alt: ADMIN CALLS MATCHED BY METADATA (if entityId mismatch) =========='

SELECT
  cn."order", cn.letter, cn.number, cn."createdAt",
  al.id AS audit_id, al."actorId", al."createdAt" AS audit_at, al.metadata
FROM "CalledNumber" cn
LEFT JOIN "AuditLog" al
  ON al.action = 'admin.game.call_number'
 AND (al.metadata->>'sessionId') = cn."gameSessionId"
 AND (al.metadata->>'number')::int = cn.number
WHERE cn."gameSessionId" = :'big_session_id'
ORDER BY cn."order";

\echo '========== D2e: CLAIMS IN THAT SESSION =========='

SELECT
  bc.id, bc."userId", u."fullName", u."phoneNumber",
  bc."gameCartelaId", bc.status, bc."checkedPattern", bc."reasonCode",
  bc."winningBallLetter", bc."winningBallNumber",
  bc."createdAt", bc."checkedAt"
FROM "BingoClaim" bc
JOIN "User" u ON u.id = bc."userId"
WHERE bc."gameSessionId" = :'big_session_id'
ORDER BY bc."createdAt";

\echo '========== D2f: REGISTRATIONS AFTER SESSION START? =========='

SELECT
  gc.id, u."phoneNumber", c.number AS cartela_number,
  gc."createdAt" AS registered_at,
  gs."startedAt",
  (gc."createdAt" > gs."startedAt") AS registered_after_start
FROM "GameCartela" gc
JOIN "User" u ON u.id = gc."userId"
JOIN "Cartela" c ON c.id = gc."cartelaId"
JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
WHERE gc."gameSessionId" = :'big_session_id'
  AND gc."createdAt" > gs."startedAt"
ORDER BY gc."createdAt";

-- Repeat D2 for the 6000-prize game specifically (if different):
\echo '========== D3: SESSION(S) WITH PRIZE ~6000 INVOLVING THIS PLAYER =========='

SELECT gs.id, gs."playCode", gs."prizeAmount"::numeric(14,2), gs.status, gs."finishedAt"
FROM "GameSession" gs
JOIN "GameCartela" gc ON gc."gameSessionId" = gs.id
WHERE gc."userId" = :'suspect_user_id'
  AND gs."prizeAmount" >= 5000
ORDER BY gs."prizeAmount" DESC;

-- =============================================================================
-- E. Admin influence (global around this player’s wins)
-- =============================================================================
\echo '========== E1: ADMIN CALL_NUMBER ON PLAYER WIN SESSIONS =========='

WITH win_sessions AS (
  SELECT DISTINCT gc."gameSessionId" AS session_id, gs."prizeAmount", gs."finishedAt"
  FROM "GameCartela" gc
  JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
  WHERE gc."userId" = :'suspect_user_id'
    AND (gc."isWinner" = true OR gc.status = 'WINNER' OR gs."winnerCartelaId" = gc.id)
)
SELECT
  ws.session_id,
  ws."prizeAmount"::numeric(14,2) AS prize,
  al."createdAt",
  al.action,
  al."actorId",
  actor."fullName" AS actor_name,
  actor.role AS actor_role,
  al.metadata
FROM win_sessions ws
JOIN "AuditLog" al
  ON al.action IN (
    'admin.game.call_number',
    'admin.bingo_claim.approve',
    'admin.bingo_claim.reject',
    'admin.winner_window.finalize_early',
    'admin.session.start',
    'admin.slot.operation_mode_change'
  )
 AND (
      (al.metadata->>'sessionId') = ws.session_id
   OR al."entityId" IN (
        SELECT cn.id FROM "CalledNumber" cn WHERE cn."gameSessionId" = ws.session_id
      )
   OR al."entityId" IN (
        SELECT bc.id FROM "BingoClaim" bc WHERE bc."gameSessionId" = ws.session_id
      )
 )
LEFT JOIN "User" actor ON actor.id = al."actorId"
ORDER BY ws."prizeAmount" DESC, al."createdAt";

\echo '========== E2: COUNT ADMIN vs TOTAL CALLS ON WIN SESSIONS =========='

WITH win_sessions AS (
  SELECT DISTINCT gc."gameSessionId" AS session_id
  FROM "GameCartela" gc
  JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
  WHERE gc."userId" = :'suspect_user_id'
    AND (gc."isWinner" = true OR gc.status = 'WINNER' OR gs."winnerCartelaId" = gc.id)
),
calls AS (
  SELECT
    cn."gameSessionId",
    COUNT(*) AS total_calls,
    COUNT(al.id) AS admin_calls_by_entity
  FROM "CalledNumber" cn
  JOIN win_sessions ws ON ws.session_id = cn."gameSessionId"
  LEFT JOIN "AuditLog" al
    ON al.action = 'admin.game.call_number'
   AND al.entity = 'CalledNumber'
   AND al."entityId" = cn.id
  GROUP BY cn."gameSessionId"
)
SELECT
  c."gameSessionId",
  gs."prizeAmount"::numeric(14,2) AS prize,
  c.total_calls,
  c.admin_calls_by_entity,
  (c.total_calls - c.admin_calls_by_entity) AS presumed_auto_calls
FROM calls c
JOIN "GameSession" gs ON gs.id = c."gameSessionId"
ORDER BY gs."prizeAmount" DESC;

-- =============================================================================
-- F. API abuse signals (DB-level)
-- =============================================================================
\echo '========== F1: CLAIM BURSTS BY THIS PLAYER =========='

SELECT
  "gameSessionId",
  status,
  "reasonCode",
  COUNT(*) AS claim_count,
  MIN("createdAt") AS first_claim,
  MAX("createdAt") AS last_claim,
  EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt"))) AS span_seconds
FROM "BingoClaim"
WHERE "userId" = :'suspect_user_id'
GROUP BY "gameSessionId", status, "reasonCode"
ORDER BY claim_count DESC, last_claim DESC
LIMIT 50;

\echo '========== F2: CLAIMS ON CARDS NOT OWNED BY CLAIMANT =========='

SELECT bc.id, bc."userId" AS claim_user, gc."userId" AS cartela_owner,
       bc."gameSessionId", bc."createdAt"
FROM "BingoClaim" bc
JOIN "GameCartela" gc ON gc.id = bc."gameCartelaId"
WHERE bc."userId" = :'suspect_user_id'
  AND gc."userId" <> bc."userId";

\echo '========== F3: INVALID CLAIMS VOLUME =========='

SELECT status, "reasonCode", COUNT(*) AS n
FROM "BingoClaim"
WHERE "userId" = :'suspect_user_id'
GROUP BY status, "reasonCode"
ORDER BY n DESC;

-- =============================================================================
-- G. Statistical result
-- =============================================================================
\echo '========== G1: OVERALL WIN RATE vs CARTELA SHARE =========='

WITH per_game AS (
  SELECT
    gc."gameSessionId",
    COUNT(*) FILTER (WHERE gc."userId" = :'suspect_user_id') AS my_cards,
    COUNT(*) AS all_cards,
    BOOL_OR(gc."userId" = :'suspect_user_id' AND (gc."isWinner" OR gc.status = 'WINNER')) AS i_won,
    MAX(gs."prizeAmount") AS prize
  FROM "GameCartela" gc
  JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
  WHERE gs.status = 'FINISHED'
    AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
    AND gc."gameSessionId" IN (
      SELECT DISTINCT "gameSessionId" FROM "GameCartela" WHERE "userId" = :'suspect_user_id'
    )
  GROUP BY gc."gameSessionId"
)
SELECT
  COUNT(*) AS games_entered,
  SUM(my_cards) AS cards_bought,
  SUM(CASE WHEN i_won THEN 1 ELSE 0 END) AS games_won,
  ROUND(AVG(my_cards::numeric / NULLIF(all_cards, 0)), 4) AS avg_cartela_share,
  ROUND(SUM(my_cards::numeric / NULLIF(all_cards, 0)), 2) AS expected_wins_approx,
  SUM(CASE WHEN i_won THEN 1 ELSE 0 END) AS observed_wins,
  ROUND(
    SUM(CASE WHEN i_won THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(my_cards::numeric / NULLIF(all_cards, 0)), 0)
  , 2) AS observed_over_expected_ratio,
  SUM(CASE WHEN prize >= 1000 THEN 1 ELSE 0 END) AS large_prize_games_entered,
  SUM(CASE WHEN prize >= 1000 AND i_won THEN 1 ELSE 0 END) AS large_prize_games_won,
  ROUND(AVG(CASE WHEN i_won THEN my_cards END), 2) AS avg_my_cards_when_won,
  ROUND(AVG(my_cards), 2) AS avg_my_cards_all_entered
FROM per_game;

\echo '========== G2: LARGE PRIZE (>=1000) EXPECTED vs OBSERVED =========='

WITH per_game AS (
  SELECT
    gc."gameSessionId",
    COUNT(*) FILTER (WHERE gc."userId" = :'suspect_user_id') AS my_cards,
    COUNT(*) AS all_cards,
    BOOL_OR(gc."userId" = :'suspect_user_id' AND (gc."isWinner" OR gc.status = 'WINNER')) AS i_won,
    MAX(gs."prizeAmount") AS prize
  FROM "GameCartela" gc
  JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
  WHERE gs.status = 'FINISHED'
    AND gs."prizeAmount" >= 1000
    AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
    AND gc."gameSessionId" IN (
      SELECT DISTINCT "gameSessionId" FROM "GameCartela" WHERE "userId" = :'suspect_user_id'
    )
  GROUP BY gc."gameSessionId"
)
SELECT
  COUNT(*) AS large_games,
  ROUND(SUM(my_cards::numeric / NULLIF(all_cards, 0)), 2) AS expected_wins,
  SUM(CASE WHEN i_won THEN 1 ELSE 0 END) AS observed_wins,
  ROUND(AVG(my_cards::numeric / NULLIF(all_cards, 0)) * 100, 2) AS avg_share_pct,
  ROUND(AVG(CASE WHEN i_won THEN my_cards END), 2) AS avg_cards_when_won,
  ROUND(AVG(all_cards), 1) AS avg_total_cartelas
FROM per_game;

\echo '========== G3: TOP WINNERS BY PRIZE VOLUME (concentration) =========='

SELECT
  u."fullName",
  u."phoneNumber",
  COUNT(DISTINCT gs.id) AS wins,
  SUM(gs."prizeAmount")::numeric(14,2) AS total_prize_won,
  ROUND(AVG(gs."prizeAmount")::numeric, 2) AS avg_prize_when_won
FROM "GameCartela" gc
JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
JOIN "User" u ON u.id = gc."userId"
WHERE gs.status = 'FINISHED'
  AND (gc."isWinner" = true OR gc.status = 'WINNER')
GROUP BY u.id, u."fullName", u."phoneNumber"
ORDER BY total_prize_won DESC
LIMIT 20;

\echo '========== G4: THIS PLAYER vs FIELD — cards when someone else wins big =========='

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "GameCartela" w
      WHERE w."gameSessionId" = gs.id
        AND w."userId" = :'suspect_user_id'
        AND (w."isWinner" OR w.status = 'WINNER')
    ) THEN 'SUSPECT_WON'
    ELSE 'OTHER_WON'
  END AS outcome,
  COUNT(*) AS games,
  ROUND(AVG(sub.my_cards), 2) AS avg_suspect_cards,
  ROUND(AVG(sub.all_cards), 2) AS avg_field_cards,
  ROUND(AVG(sub.my_cards::numeric / NULLIF(sub.all_cards, 0)) * 100, 2) AS avg_suspect_share_pct
FROM "GameSession" gs
JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE gc."userId" = :'suspect_user_id') AS my_cards,
    COUNT(*) AS all_cards
  FROM "GameCartela" gc
  WHERE gc."gameSessionId" = gs.id
    AND gc.status IN ('REGISTERED', 'WINNER', 'BLOCKED')
) sub ON true
WHERE gs.status = 'FINISHED'
  AND gs."prizeAmount" >= 1000
  AND EXISTS (
    SELECT 1 FROM "GameCartela" x
    WHERE x."gameSessionId" = gs.id AND x."userId" = :'suspect_user_id'
  )
GROUP BY 1;

-- =============================================================================
-- H. Quick verdict helpers (interpret manually)
-- =============================================================================
\echo '========== H: VERDICT CHECKLIST OUTPUT =========='
\echo 'Interpret:'
\echo '  - If G2 observed_wins >> expected_wins AND E2 admin_calls > 0 on those sessions -> admin/manual intervention'
\echo '  - If G2 observed ≈ expected AND share was high (e.g. 30/300=10% but still lucky) -> statistically unusual but possible'
\echo '  - If B5 withdrawals >> deposits + prizes inconsistent -> wallet/ledger anomaly'
\echo '  - If F2 rows exist -> authorization flaw'
\echo '  - If D2d many ADMIN on completing balls near bingo -> admin influence'
\echo '  - Code already: auto-call SQL never reads GameCartela/User — confirm with E2 all-zero admin on AUTO games'
\echo 'DONE.'
