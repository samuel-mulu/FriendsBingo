import {
  cellIndexForCalledNumber,
  resolveWinningBallCellIndex,
} from './session-winner-results.builder';

describe('session-winner-results.builder helpers', () => {
  const cartela = {
    b: ['1', '2', '3', '4', '5'],
    i: ['16', '17', '18', '19', '20'],
    n: ['31', '32', 'FREE', '34', '35'],
    g: ['46', '47', '48', '49', '50'],
    o: ['61', '62', '63', '64', '65'],
  };

  it('maps B-5 to row 4 column B (index 20)', () => {
    expect(cellIndexForCalledNumber(cartela, 5)).toBe(20);
  });

  it('returns winningBallCellIndex only when last ball is in pattern cells', () => {
    const completedPatterns = [
      {
        type: 'row',
        numbers: [1, 2, 3, 4, 5],
        cells: [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
        ] as [number, number][],
      },
    ];

    expect(
      resolveWinningBallCellIndex(
        cartela,
        { letter: 'B', number: 5 },
        completedPatterns,
      ),
    ).toBe(20);

    expect(
      resolveWinningBallCellIndex(
        cartela,
        { letter: 'I', number: 20 },
        completedPatterns,
      ),
    ).toBeNull();
  });
});
