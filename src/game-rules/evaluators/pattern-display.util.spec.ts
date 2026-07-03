import { selectCompletedPatternsForDisplay } from './pattern-display.util';

describe('selectCompletedPatternsForDisplay', () => {
  const row1 = {
    type: 'ROW',
    key: 'ROW_1',
    numbers: [1, 2, 3, 4, 5],
    cells: [],
  };
  const row2 = {
    type: 'ROW',
    key: 'ROW_2',
    numbers: [6, 7, 8, 9, 10],
    cells: [],
  };
  const row3 = {
    type: 'ROW',
    key: 'ROW_3',
    numbers: [11, 12, 13, 14, 15],
    cells: [],
  };

  it('returns a single pattern containing the latest ball for any-line wins', () => {
    const result = selectCompletedPatternsForDisplay([row1, row2, row3], {
      latestCalledNumber: 13,
    });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('ROW_3');
  });

  it('caps multi-line wins to the required count preferring the latest ball', () => {
    const result = selectCompletedPatternsForDisplay([row1, row2, row3], {
      requiredCount: 2,
      latestCalledNumber: 13,
    });

    expect(result).toHaveLength(2);
    expect(result.some((pattern) => pattern.key === 'ROW_3')).toBe(true);
  });
});
