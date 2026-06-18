import {
  ethiopianPhoneLookupVariants,
  normalizeEthiopianPhone,
  maskEthiopianPhone,
  toLocalEthiopianPhone,
} from './phone.util';

describe('phone.util', () => {
  it('normalizes 09 numbers to 2519 format', () => {
    expect(normalizeEthiopianPhone('0962520885')).toBe('251962520885');
  });

  it('keeps already normalized numbers', () => {
    expect(normalizeEthiopianPhone('251962520885')).toBe('251962520885');
  });

  it('masks phone for display', () => {
    expect(maskEthiopianPhone('0962520885')).toBe('0962******');
  });

  it('converts normalized phone to local format', () => {
    expect(toLocalEthiopianPhone('251962520885')).toBe('0962520885');
  });

  it('returns normalized and local lookup variants', () => {
    expect(ethiopianPhoneLookupVariants('0962520885')).toEqual([
      '251962520885',
      '0962520885',
    ]);
  });
});
