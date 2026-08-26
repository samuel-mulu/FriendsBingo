import { maskWinnerPhoneLocalMiddleTwo } from './phone.util';

describe('maskWinnerPhoneLocalMiddleTwo', () => {
  it('masks two middle digits for standard local numbers', () => {
    expect(maskWinnerPhoneLocalMiddleTwo('0962520885')).toBe('0962**0885');
  });

  it('returns short values unchanged', () => {
    expect(maskWinnerPhoneLocalMiddleTwo('0962')).toBe('0962');
    expect(maskWinnerPhoneLocalMiddleTwo('09625')).toBe('09625');
  });
});
