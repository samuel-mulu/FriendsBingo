import {
  isMarketingCategory,
  isRateExemptCategory,
  PUSH_MARKETING_CATEGORIES,
} from './push-rate-policy';

describe('push-rate-policy', () => {
  it('does not treat REGISTRATION_OPEN as a marketing category', () => {
    expect(isMarketingCategory('REGISTRATION_OPEN')).toBe(false);
    expect(PUSH_MARKETING_CATEGORIES.has('REGISTRATION_OPEN')).toBe(false);
  });

  it('keeps big-game broadcasts on the marketing policy', () => {
    expect(isMarketingCategory('BIG_GAME_REGISTRATION_OPEN')).toBe(true);
    expect(isMarketingCategory('BIG_GAME_TOMORROW')).toBe(true);
    expect(isMarketingCategory('BIG_GAME_TODAY')).toBe(true);
  });

  it('does not rate-exempt REGISTRATION_OPEN from the global cap', () => {
    expect(isRateExemptCategory('REGISTRATION_OPEN')).toBe(false);
  });

  it('keeps wallet and winner categories rate-exempt', () => {
    expect(isRateExemptCategory('WINNER_ANNOUNCEMENT')).toBe(true);
    expect(isRateExemptCategory('DEPOSIT_APPROVED')).toBe(true);
    expect(isRateExemptCategory('WITHDRAWAL_APPROVED')).toBe(true);
    expect(isRateExemptCategory('WITHDRAWAL_COMPLETED')).toBe(true);
    expect(isRateExemptCategory('WITHDRAWAL_REJECTED')).toBe(true);
  });
});
