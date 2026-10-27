import {
  CartelaPaymentSource,
  GameCategory,
} from '@prisma/client';
import {
  isBigGameCategory,
  isBonusCategory,
  isChainGameCategory,
  isNormalCategory,
} from '../games/game-category.util';

export function isRegistrationCashbackEligibleCategory(
  category?: GameCategory | null,
): boolean {
  if (!category) {
    return false;
  }
  return (
    isNormalCategory(category) ||
    category === GameCategory.BIG_GOTD ||
    isChainGameCategory(category)
  );
}

export function isRegistrationCashbackExcludedCategory(
  category?: GameCategory | null,
): boolean {
  return isBonusCategory(category) || isBigGameCategory(category);
}

export function isQualifyingRegistrationPayment(
  paymentSource?: CartelaPaymentSource | null,
): boolean {
  return paymentSource === CartelaPaymentSource.MONEY_WALLET;
}
