/**
 * Resolves how many Force Big Tickets each winning cartela receives from the
 * total pool (`forceCount`).
 *
 * - 1 winner: full pool
 * - 2 winners: even split
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
    return Math.floor(forceCount / 2);
  }

  return 0;
}
