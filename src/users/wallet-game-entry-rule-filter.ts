import { Prisma } from '@prisma/client';

/**
 * SQL predicate (aliases `gs` = GameSession, `slot` = GameSlot) for "this entry
 * was for gameRuleId".
 *
 * Normal, bonus, Big GOTD, and Big Game: one charge belongs to one rule.
 * Prefer the session rule (Big Game writes it per round) and fall back to the
 * slot rule, which is where single-rule games keep it.
 *
 * Chain Game: the player pays once for the whole chain, and GameSession.gameRuleId
 * is overwritten as rounds advance. Match the slot rule, the current session
 * rule, or any id stored in slot.roundGameRuleIds.
 */
export function walletGameEntryRuleMatchSql(gameRuleId: string): Prisma.Sql {
  return Prisma.sql`(
    (
      slot.category::text <> 'CHAIN_GAME'
      AND COALESCE(gs."gameRuleId", slot."gameRuleId") = ${gameRuleId}
    )
    OR (
      slot.category::text = 'CHAIN_GAME'
      AND (
        slot."gameRuleId" = ${gameRuleId}
        OR gs."gameRuleId" = ${gameRuleId}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN slot."roundGameRuleIds" IS NOT NULL
                AND jsonb_typeof(slot."roundGameRuleIds") = 'array'
              THEN slot."roundGameRuleIds"
              ELSE '[]'::jsonb
            END
          ) AS round_rule(rule_id)
          WHERE round_rule.rule_id = ${gameRuleId}
        )
      )
    )
  )`;
}

/** Wallet rows (alias `wt`) that are game entries or entry refunds for a rule. */
export function walletGameEntryRuleFilterSql(params: {
  userId: string;
  gameRuleId: string;
}): Prisma.Sql {
  const { userId, gameRuleId } = params;

  return Prisma.sql`
    wt."userId" = ${userId}
    AND wt.type IN ('GAME_ENTRY', 'REFUND')
    AND (
      (
        wt."referenceType" = 'GAME_CARTELA'
        AND EXISTS (
          SELECT 1
          FROM "GameCartela" gc
          INNER JOIN "GameSession" gs ON gs.id = gc."gameSessionId"
          INNER JOIN "GameSlot" slot ON slot.id = gs."gameSlotId"
          WHERE gc.id = wt."referenceId"
            AND gc."userId" = wt."userId"
            AND ${walletGameEntryRuleMatchSql(gameRuleId)}
        )
      )
      OR (
        wt."referenceType" = 'GAME_SESSION_CANCEL'
        AND EXISTS (
          SELECT 1
          FROM "GameSession" gs
          INNER JOIN "GameSlot" slot ON slot.id = gs."gameSlotId"
          WHERE wt."referenceId" = gs.id || ':' || ${userId}
            AND ${walletGameEntryRuleMatchSql(gameRuleId)}
        )
      )
    )
  `;
}
