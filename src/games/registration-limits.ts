/** Maximum cartelas per bulk reserve/register HTTP request. */
export const MAX_BULK_CARTELAS_PER_REQUEST = 100;

/** Internal commit chunk size for bulk registration transactions. */
export const BULK_COMMIT_CHUNK_SIZE = 20;

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
