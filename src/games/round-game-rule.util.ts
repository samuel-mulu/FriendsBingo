/**
 * Parse BIG_GAME / CHAIN_GAME slot.roundGameRuleIds JSON into a string UUID array.
 * Returns [] when missing/invalid (callers apply slot.gameRuleId fallback).
 */
export function parseRoundGameRuleIds(roundGameRuleIds: unknown): string[] {
  if (!Array.isArray(roundGameRuleIds) || roundGameRuleIds.length === 0) {
    return [];
  }

  return roundGameRuleIds
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);
}

/**
 * Resolve the GameRule id for a given 1-based round index.
 */
export function resolveRoundGameRuleId(params: {
  roundIndex: number;
  roundGameRuleIds: unknown;
  fallbackGameRuleId: string | null | undefined;
}): string | null {
  const ids = parseRoundGameRuleIds(params.roundGameRuleIds);
  const index = Math.max(1, params.roundIndex) - 1;
  if (ids.length > 0 && index >= 0 && index < ids.length) {
    return ids[index] ?? null;
  }
  return params.fallbackGameRuleId ?? null;
}

export type SessionGameRuleSummary = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  patterns?: unknown;
} | null;

/**
 * Prefer session-materialized rule, else slot rule (legacy / non–Big-Game).
 */
export function resolveSessionGameRule<T extends SessionGameRuleSummary>(params: {
  sessionGameRule?: T;
  slotGameRule?: T;
}): T {
  return (params.sessionGameRule ?? params.slotGameRule ?? null) as T;
}

export function resolveSessionGameRuleKey(params: {
  sessionGameRuleKey?: string | null;
  slotGameRuleKey?: string | null;
  slotGameType?: string | null;
}): string {
  return (
    params.sessionGameRuleKey ??
    params.slotGameRuleKey ??
    params.slotGameType ??
    ''
  );
}
