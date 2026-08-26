import { WinnerPhoneDisplayMode } from '@prisma/client';
import { resolveWinnerDisplayPhoneNumber } from './session-winner-results.builder';

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
