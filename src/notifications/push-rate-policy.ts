import type { PushCategory } from './types/push-category.type';

/** Wallet and winner pushes are always delivered when dedupe allows. */
export const PUSH_RATE_EXEMPT_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'DEPOSIT_APPROVED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_REJECTED',
  'WINNER_ANNOUNCEMENT',
  'SYSTEM',
]);

/** Big-game reminder broadcasts share a tighter per-user cap. */
export const PUSH_MARKETING_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'BIG_GAME_REGISTRATION_OPEN',
  'BIG_GAME_TOMORROW',
  'BIG_GAME_TODAY',
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
