import {
  cellIndexForCalledNumber,
  filterCalledNumbersAtClaimTime,
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

  it('filterCalledNumbersAtClaimTime excludes balls called after claim', () => {
    const claimCheckedAt = new Date('2026-06-22T12:00:05.000Z');
    const calledNumbers = [
      {
        letter: 'B',
        number: 7,
        order: 1,
        createdAt: new Date('2026-06-22T12:00:01.000Z'),
      },
      {
        letter: 'I',
        number: 16,
        order: 2,
        createdAt: new Date('2026-06-22T12:00:03.000Z'),
      },
      {
        letter: 'N',
        number: 42,
        order: 3,
        createdAt: new Date('2026-06-22T12:00:10.000Z'),
      },
    ];

    expect(filterCalledNumbersAtClaimTime(calledNumbers, claimCheckedAt)).toEqual(
      [
        { letter: 'B', number: 7, order: 1 },
        { letter: 'I', number: 16, order: 2 },
      ],
    );
  });
});
