import type { PushCategory } from './types/push-category.type';

/** Wallet and winner pushes are always delivered when dedupe allows. */
export const PUSH_RATE_EXEMPT_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'DEPOSIT_APPROVED',
  'DEPOSIT_REJECTED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_REJECTED',
  'WINNER_ANNOUNCEMENT',
  'BIG_GAME_TICKET_GRANTED',
  'SYSTEM',
]);

/** Big-game reminder broadcasts share a tighter per-user cap. */
export const PUSH_MARKETING_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'BIG_GAME_REGISTRATION_OPEN',
  'BIG_GAME_TOMORROW',
  'BIG_GAME_TODAY',
]);

/**
 * Marketing-style game alerts sent to users who may not be registered.
 * Only `gamePushMode=ALWAYS` users receive these.
 */
export const PUSH_BROADCAST_GAME_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'REGISTRATION_OPEN',
  'BIG_GAME_REGISTRATION_OPEN',
  'BIG_GAME_TOMORROW',
  'BIG_GAME_TODAY',
]);

/**
 * Session / personal game alerts for cartela owners (or ticket recipients).
 * Sent when `gamePushMode` is ALWAYS or REGISTERED_ONLY (not OFF).
 */
export const PUSH_SESSION_GAME_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'GAME_STARTED',
  'BONUS_GAME_STARTED',
  'WINNER_WINDOW_STARTED',
  'GAME_FINISHED',
  'WINNER_ANNOUNCEMENT',
  'BIG_GAME_TICKET_GRANTED',
]);

export const GLOBAL_PUSH_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_PUSH_MAX_PER_WINDOW = 5;

export const MARKETING_PUSH_WINDOW_MS = 30 * 60 * 1000;
export const MARKETING_PUSH_MAX_PER_WINDOW = 2;

export function normalizePushEntityId(entityId?: string | null) {
  return entityId?.trim() ?? '';
}

export function isRateExemptCategory(category: PushCategory) {
  return PUSH_RATE_EXEMPT_CATEGORIES.has(category);
}

export function isMarketingCategory(category: PushCategory) {
  return PUSH_MARKETING_CATEGORIES.has(category);
}

export function isBroadcastGameCategory(category: PushCategory) {
  return PUSH_BROADCAST_GAME_CATEGORIES.has(category);
}

export function isSessionGameCategory(category: PushCategory) {
  return PUSH_SESSION_GAME_CATEGORIES.has(category);
}
