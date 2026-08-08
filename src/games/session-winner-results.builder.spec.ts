import { resolveWinnerDisplayPhoneNumber } from './session-winner-results.builder';

describe('resolveWinnerDisplayPhoneNumber', () => {
  it('omits phone when the admin flag is off', () => {
    expect(
      resolveWinnerDisplayPhoneNumber('251962520885', false),
    ).toBeUndefined();
    expect(resolveWinnerDisplayPhoneNumber('0962520885', false)).toBeUndefined();
  });

  it('returns local format when the admin flag is on', () => {
    expect(resolveWinnerDisplayPhoneNumber('251962520885', true)).toBe(
      '0962520885',
    );
    expect(resolveWinnerDisplayPhoneNumber('0962520885', true)).toBe(
      '0962520885',
    );
    expect(resolveWinnerDisplayPhoneNumber('962520885', true)).toBe(
      '0962520885',
    );
  });

  it('returns null when flag is on but phone is missing', () => {
    expect(resolveWinnerDisplayPhoneNumber(null, true)).toBeNull();
    expect(resolveWinnerDisplayPhoneNumber('', true)).toBeNull();
    expect(resolveWinnerDisplayPhoneNumber('   ', true)).toBeNull();
  });
});
