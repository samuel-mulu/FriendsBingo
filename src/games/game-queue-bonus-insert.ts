import { compareSortOrder } from './game-category.util';

export type BonusInsertReadySnapshot = {
  slotId: string;
  sessionId: string;
  sortOrder: number;
  cartelaCount: number;
};

export type BonusInsertContext = {
  liveMaxSortOrder: number | null;
  ready: BonusInsertReadySnapshot | null;
};

export type BonusInsertPlan = {
  /** sortOrder to assign to the new BONUS / BIG_GOTD slot */
  insertSortOrder: number;
  /**
   * Empty READY to demote (cancel session, keep slot as NEXT behind the insert).
   * Null when there is no READY or READY already has registrations.
   */
  demoteEmptyReady: Pick<
    BonusInsertReadySnapshot,
    'slotId' | 'sessionId'
  > | null;
};

/**
 * Cartela-aware insert plan for BONUS / BIG_GOTD on create.
 *
 * - No READY, or READY with 0 cartelas → insert after live/checking (or at 1).
 * - READY with cartelas → insert immediately after that READY.
 */
export function resolveBonusLikeInsertPlan(
  context: BonusInsertContext,
): BonusInsertPlan {
  const ready = context.ready;

  if (ready != null && ready.cartelaCount > 0) {
    return {
      insertSortOrder: ready.sortOrder + 1,
      demoteEmptyReady: null,
    };
  }

  const anchor = context.liveMaxSortOrder ?? 0;

  return {
    insertSortOrder: anchor + 1,
    demoteEmptyReady:
      ready != null && ready.cartelaCount === 0
        ? { slotId: ready.slotId, sessionId: ready.sessionId }
        : null,
  };
}

/**
 * When any READY candidate already has registrations, those win over
 * bonus-like priority so a newly added BONUS/BIG_GOTD cannot steal
 * registration from a filled READY.
 */
export function selectRegistrationCandidatesPreferringFilled<
  T extends {
    registeredCartelasCount: number;
    sortOrder: number | null;
  },
>(candidates: T[]): T[] {
  const filled = candidates.filter(
    (candidate) => candidate.registeredCartelasCount > 0,
  );

  if (filled.length === 0) {
    return candidates;
  }

  return [...filled].sort((left, right) =>
    compareSortOrder(left.sortOrder, right.sortOrder),
  );
}
