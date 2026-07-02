import { PatternInstance } from './combo.types';
import { isCombinationNewlyCompletedByLatestNumber } from './combo-solver';

function pattern(
  id: string,
  numbers: number[],
): PatternInstance {
  return {
    id,
    kind: 'LINE',
    cells: [],
    numbers,
    touchesFree: false,
    usesDiagonal: false,
  };
}

describe('isCombinationNewlyCompletedByLatestNumber', () => {
  it('returns true when latest completes a pattern in a not-yet-complete combination', () => {
    const combination = [
      pattern('ROW_1', [1, 2, 3, 4, 5]),
      pattern('ROW_2', [6, 7, 8, 9, 10]),
      pattern('ROW_5', [21, 22, 23, 24, 25]),
    ];
    const beforeCompletePatternIds = new Set(['ROW_1', 'ROW_2']);

    expect(
      isCombinationNewlyCompletedByLatestNumber(
        combination,
        25,
        beforeCompletePatternIds,
      ),
    ).toBe(true);
  });

  it('returns false when the combination was already complete before latest', () => {
    const combination = [
      pattern('ROW_1', [1, 2, 3, 4, 5]),
      pattern('ROW_2', [6, 7, 8, 9, 10]),
      pattern('ROW_4', [16, 17, 18, 19, 20]),
    ];
    const beforeCompletePatternIds = new Set(['ROW_1', 'ROW_2', 'ROW_4']);

    expect(
      isCombinationNewlyCompletedByLatestNumber(
        combination,
        20,
        beforeCompletePatternIds,
      ),
    ).toBe(false);
  });

  it('returns false when latest is not part of the combination', () => {
    const combination = [
      pattern('ROW_1', [1, 2, 3, 4, 5]),
      pattern('ROW_2', [6, 7, 8, 9, 10]),
      pattern('ROW_4', [16, 17, 18, 19, 20]),
    ];
    const beforeCompletePatternIds = new Set(['ROW_1', 'ROW_2']);

    expect(
      isCombinationNewlyCompletedByLatestNumber(
        combination,
        99,
        beforeCompletePatternIds,
      ),
    ).toBe(false);
  });
});
