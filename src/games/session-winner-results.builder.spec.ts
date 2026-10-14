import { WinnerPhoneDisplayMode } from '@prisma/client';
import {
  filterCalledNumbersThroughWinningBall,
  resolveWinnerDisplayPhoneNumber,
} from './session-winner-results.builder';

describe('filterCalledNumbersThroughWinningBall', () => {
  const calls = [
    { letter: 'B', number: 1, order: 1, createdAt: new Date('2026-01-01T00:00:01Z') },
    { letter: 'I', number: 20, order: 2, createdAt: new Date('2026-01-01T00:00:02Z') },
    { letter: 'N', number: 35, order: 3, createdAt: new Date('2026-01-01T00:00:03Z') },
    { letter: 'G', number: 50, order: 4, createdAt: new Date('2026-01-01T00:00:04Z') },
  ];

  it('returns all calls when winning ball is missing', () => {
    expect(filterCalledNumbersThroughWinningBall(calls, null)).toEqual([
      { letter: 'B', number: 1, order: 1 },
      { letter: 'I', number: 20, order: 2 },
      { letter: 'N', number: 35, order: 3 },
      { letter: 'G', number: 50, order: 4 },
    ]);
  });

  it('truncates through the historical winning ball', () => {
    expect(
      filterCalledNumbersThroughWinningBall(calls, {
        letter: 'I',
        number: 20,
      }),
    ).toEqual([
      { letter: 'B', number: 1, order: 1 },
      { letter: 'I', number: 20, order: 2 },
    ]);
  });

  it('keeps full list when winning ball was never called', () => {
    expect(
      filterCalledNumbersThroughWinningBall(calls, {
        letter: 'O',
        number: 75,
      }),
    ).toHaveLength(4);
  });
});

describe('resolveWinnerDisplayPhoneNumber', () => {
  it('omits phone when display mode is HIDDEN', () => {
    expect(
      resolveWinnerDisplayPhoneNumber('251962520885', WinnerPhoneDisplayMode.HIDDEN),
    ).toBeUndefined();
    expect(
      resolveWinnerDisplayPhoneNumber('0962520885', WinnerPhoneDisplayMode.HIDDEN),
    ).toBeUndefined();
  });

  it('returns local format when display mode is FULL', () => {
    expect(resolveWinnerDisplayPhoneNumber('251962520885', WinnerPhoneDisplayMode.FULL)).toBe(
      '0962520885',
    );
    expect(resolveWinnerDisplayPhoneNumber('0962520885', WinnerPhoneDisplayMode.FULL)).toBe(
      '0962520885',
    );
    expect(resolveWinnerDisplayPhoneNumber('962520885', WinnerPhoneDisplayMode.FULL)).toBe(
      '0962520885',
    );
  });

  it('returns masked local format when display mode is MASKED', () => {
    expect(resolveWinnerDisplayPhoneNumber('251962520885', WinnerPhoneDisplayMode.MASKED)).toBe(
      '0962**0885',
    );
    expect(resolveWinnerDisplayPhoneNumber('0962520885', WinnerPhoneDisplayMode.MASKED)).toBe(
      '0962**0885',
    );
  });

  it('returns null when mode shows phone but value is missing', () => {
    expect(resolveWinnerDisplayPhoneNumber(null, WinnerPhoneDisplayMode.FULL)).toBeNull();
    expect(resolveWinnerDisplayPhoneNumber('', WinnerPhoneDisplayMode.FULL)).toBeNull();
    expect(resolveWinnerDisplayPhoneNumber('   ', WinnerPhoneDisplayMode.MASKED)).toBeNull();
  });
});
