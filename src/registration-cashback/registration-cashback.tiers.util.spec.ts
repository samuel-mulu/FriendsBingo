import { BadRequestException } from '@nestjs/common';
import {
  parseTiersFromJson,
  resolveRegistrationCashbackTier,
  validateTierOrdering,
} from './registration-cashback.tiers.util';

describe('registration-cashback tiers', () => {
  const tiers = [
    { minCartelasInSession: 50, rewardEtb: '10' },
    { minCartelasInSession: 70, rewardEtb: '20' },
  ];

  it('resolves highest matching tier', () => {
    expect(resolveRegistrationCashbackTier(49, tiers)).toBeNull();
    expect(resolveRegistrationCashbackTier(50, tiers)).toEqual({
      minCartelasInSession: 50,
      rewardEtb: '10',
    });
    expect(resolveRegistrationCashbackTier(65, tiers)).toEqual({
      minCartelasInSession: 50,
      rewardEtb: '10',
    });
    expect(resolveRegistrationCashbackTier(70, tiers)).toEqual({
      minCartelasInSession: 70,
      rewardEtb: '20',
    });
  });

  it('rejects unsorted tiers', () => {
    expect(() =>
      validateTierOrdering([
        { minCartelasInSession: 70, rewardEtb: '20' },
        { minCartelasInSession: 50, rewardEtb: '10' },
      ]),
    ).toThrow(BadRequestException);
  });

  it('parses tiers from json', () => {
    const parsed = parseTiersFromJson([
      { minCartelasInSession: 50, rewardEtb: '10' },
      { minCartelasInSession: 70, rewardEtb: 20 },
    ]);
    expect(parsed).toEqual(tiers);
  });
});
