import {
  buildCartelaNumberPrefixRanges,
  decodeCartelaCursor,
  encodeCartelaCursor,
} from './cartelas-prefix.util';

describe('cartelas-prefix.util', () => {
  it('builds numeric prefix ranges for multi-length matches', () => {
    expect(buildCartelaNumberPrefixRanges('12')).toEqual([
      { min: 12, max: 12 },
      { min: 120, max: 129 },
      { min: 1200, max: 1299 },
      { min: 12000, max: 12999 },
      { min: 120000, max: 129999 },
      { min: 1200000, max: 1299999 },
      { min: 12000000, max: 12999999 },
      { min: 120000000, max: 129999999 },
      { min: 1200000000, max: 1299999999 },
    ]);
  });

  it('encodes and decodes cartela cursors', () => {
    const cursor = encodeCartelaCursor(42, 'cartela-uuid');
    expect(decodeCartelaCursor(cursor)).toEqual({
      number: 42,
      id: 'cartela-uuid',
    });
  });
});
