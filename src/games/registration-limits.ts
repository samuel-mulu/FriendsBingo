/** Maximum cartelas per bulk reserve/register HTTP request. */
export const MAX_BULK_CARTELAS_PER_REQUEST = 60;

/** Internal commit chunk size for bulk registration transactions. */
export const BULK_COMMIT_CHUNK_SIZE = 20;

/**
 * Per-player cartela cap for NORMAL category sessions.
 * Matches bulk max so wallet-only abuse cannot exceed product bulk limit.
 */
export const MAX_CARTELAS_PER_PLAYER_NORMAL = MAX_BULK_CARTELAS_PER_REQUEST;

export function chunkCartelaItems<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
