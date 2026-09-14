/** Allowed Force Big Ticket pools: 1, or even 2–10. */
export const FORCE_BIG_GAME_TICKET_COUNTS = [1, 2, 4, 6, 8, 10] as const;

export function isValidForceBigGameCartelaCount(forceCount: number): boolean {
  return (FORCE_BIG_GAME_TICKET_COUNTS as readonly number[]).includes(
    forceCount,
  );
}

/**
 * Resolves how many Force Big Tickets each winning cartela receives from the
 * total pool (`forceCount`).
 *
 * - 1 winner: full pool
 * - 2 winners: even split, except pool 1 grants 1 ticket to each winner
 * - 3+: no charge / grant
 */
export function resolveForceBigGameTicketsPerWinner(
  forceCount: number,
  winnerCount: number,
): number {
  if (forceCount <= 0 || winnerCount <= 0) {
    return 0;
  }

  if (winnerCount === 1) {
    return forceCount;
  }

  if (winnerCount === 2) {
    if (forceCount === 1) {
      return 1;
    }
    return Math.floor(forceCount / 2);
  }

  return 0;
}
