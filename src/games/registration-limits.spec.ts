import {
  BULK_COMMIT_CHUNK_SIZE,
  chunkCartelaItems,
  MAX_BULK_CARTELAS_PER_REQUEST,
  MAX_CARTELAS_PER_PLAYER_NORMAL,
} from './registration-limits';

describe('registration-limits', () => {
  it('exposes product limits', () => {
    expect(MAX_BULK_CARTELAS_PER_REQUEST).toBe(60);
    expect(BULK_COMMIT_CHUNK_SIZE).toBe(20);
    expect(MAX_CARTELAS_PER_PLAYER_NORMAL).toBe(60);
  });

  it('chunks cartela items without loss', () => {
    const items = Array.from({ length: 55 }, (_, index) => index + 1);
    const chunks = chunkCartelaItems(items, BULK_COMMIT_CHUNK_SIZE);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(15);
    expect(chunks.flat()).toEqual(items);
  });
});
