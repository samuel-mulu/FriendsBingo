/**
 * How the player initiated the bingo claim.
 * MANUAL = tap / default. AUTO = Auto Bingo client scheduler.
 * Server re-authorizes AUTO from User grants+prefs; never trust client effective flags.
 */
export enum BingoClaimSource {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

export function resolveBingoClaimSource(
  raw: BingoClaimSource | string | undefined | null,
): BingoClaimSource {
  if (raw == null || raw === '') {
    return BingoClaimSource.MANUAL;
  }
  return raw as BingoClaimSource;
}
