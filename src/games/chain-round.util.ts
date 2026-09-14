import { GameCategory, GameStatus, Prisma } from '@prisma/client';
import { resolveRoundGameRuleId } from './round-game-rule.util';

/**
 * CHAIN_GAME pauses are a live winner reveal on the SAME session, not a session
 * handoff, so the bounds are far tighter than BIG_GAME's inter-round delay.
 */
export const CHAIN_GAME_MIN_INTER_ROUND_DELAY_SECONDS = 5;
export const CHAIN_GAME_MAX_INTER_ROUND_DELAY_SECONDS = 300;
export const CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS = 20;

export const BIG_GAME_MIN_INTER_ROUND_DELAY_SECONDS = 60;
export const BIG_GAME_MAX_INTER_ROUND_DELAY_SECONDS = 3600;

/** Upper bound for a single admin "extend pause" action. */
export const CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS = 120;

export function isChainDebugEnabled(): boolean {
  return process.env.CHAIN_DEBUG === 'true';
}

/**
 * Parse slot.roundPrizes JSON into Decimals. Returns [] when missing/invalid so
 * callers can fall back to fixedPrizeAmount.
 */
export function parseRoundPrizeDecimals(roundPrizes: unknown): Prisma.Decimal[] {
  if (!Array.isArray(roundPrizes) || roundPrizes.length === 0) {
    return [];
  }

  const parsed: Prisma.Decimal[] = [];
  for (const value of roundPrizes) {
    try {
      parsed.push(new Prisma.Decimal(String(value ?? '0')));
    } catch {
      return [];
    }
  }
  return parsed;
}

/**
 * Prize for a 1-based round index, falling back to the whole-chain pool when the
 * per-round array is missing (single-round or legacy rows).
 */
export function resolveRoundPrizeAmount(params: {
  roundIndex: number;
  roundPrizes: unknown;
  fallbackPrizeAmount?: Prisma.Decimal | string | null;
}): Prisma.Decimal {
  const prizes = parseRoundPrizeDecimals(params.roundPrizes);
  const index = Math.max(1, params.roundIndex) - 1;
  const hit = index >= 0 && index < prizes.length ? prizes[index] : undefined;
  if (hit) {
    return hit;
  }
  return new Prisma.Decimal(params.fallbackPrizeAmount?.toString() ?? '0');
}

/** True while a chain session is between rounds and must not call numbers. */
export function isChainRoundPaused(
  session: {
    status?: GameStatus | null;
    roundPausedUntil?: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (session.roundPausedUntil == null) {
    return false;
  }
  if (session.status != null && session.status !== GameStatus.PLAYING) {
    return false;
  }
  return session.roundPausedUntil.getTime() > now.getTime();
}

/** True when the finished round is not the last one in the chain. */
export function hasRemainingChainRounds(params: {
  roundIndex: number;
  roundCount: number;
}): boolean {
  return params.roundIndex < params.roundCount;
}

export type ChainRoundSeedSlot = {
  category?: GameCategory | null;
  gameRuleId?: string | null;
  roundPrizes?: unknown;
  roundGameRuleIds?: unknown;
  fixedPrizeAmount?: Prisma.Decimal | null;
};

/**
 * Round-1 seed fields for a freshly created CHAIN_GAME session. Returns `{}` for every
 * other category so callers can spread it unconditionally without touching their flow.
 *
 * `prizeAmount` is deliberately NOT set here: it stays the whole-chain pool from
 * buildSessionMoneyConfig, while `roundPrizeAmount` carries the per-round figure.
 */
export function buildChainRoundSeedData(slot: ChainRoundSeedSlot): {
  roundIndex?: number;
  gameRuleId?: string | null;
  roundPrizeAmount?: Prisma.Decimal;
} {
  if (slot.category !== GameCategory.CHAIN_GAME) {
    return {};
  }

  return {
    roundIndex: 1,
    gameRuleId: resolveRoundGameRuleId({
      roundIndex: 1,
      roundGameRuleIds: slot.roundGameRuleIds,
      fallbackGameRuleId: slot.gameRuleId,
    }),
    roundPrizeAmount: resolveRoundPrizeAmount({
      roundIndex: 1,
      roundPrizes: slot.roundPrizes,
      fallbackPrizeAmount: slot.fixedPrizeAmount,
    }),
  };
}
