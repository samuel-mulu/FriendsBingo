import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCategory,
  Prisma,
} from '@prisma/client';
import {
  canUseBonusCartelaBalance,
  isFreeEntryCategory,
} from './game-category.util';

export type RegistrationAccounting = {
  paymentSource: CartelaPaymentSource | null;
  entryFeeCents: number;
  prizeContributionCents: number;
  companyFeeCents: number;
  companyFeeSource: CompanyFeeSource | null;
};

export type RegistrationSessionEconomics = {
  entryFee: Prisma.Decimal;
  prizePerCartela: Prisma.Decimal;
  companyFeePerCartela: Prisma.Decimal;
  gameSlot: {
    category: GameCategory;
  };
};

export function decimalToCents(amount: Prisma.Decimal): number {
  return amount.mul(100).round().toNumber();
}

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export function buildFreeEntryAccounting(): RegistrationAccounting {
  return {
    paymentSource: null,
    entryFeeCents: 0,
    prizeContributionCents: 0,
    companyFeeCents: 0,
    companyFeeSource: null,
  };
}

export function buildPaidEntryAccounting(
  session: RegistrationSessionEconomics,
  paymentSource: CartelaPaymentSource,
): RegistrationAccounting {
  return {
    paymentSource,
    entryFeeCents: decimalToCents(session.entryFee),
    prizeContributionCents: decimalToCents(session.prizePerCartela),
    companyFeeCents: decimalToCents(session.companyFeePerCartela),
    companyFeeSource:
      paymentSource === CartelaPaymentSource.BONUS_CARTELA
        ? CompanyFeeSource.BONUS
        : CompanyFeeSource.MONEY,
  };
}

export function resolveRegistrationAccounting(
  session: RegistrationSessionEconomics,
  bonusCartelaBalance: number,
): RegistrationAccounting & { isFreeEntry: boolean } {
  if (isFreeEntryCategory(session.gameSlot.category)) {
    return {
      ...buildFreeEntryAccounting(),
      isFreeEntry: true,
    };
  }

  const paymentSource =
    canUseBonusCartelaBalance(session.gameSlot.category) &&
    bonusCartelaBalance > 0
      ? CartelaPaymentSource.BONUS_CARTELA
      : CartelaPaymentSource.MONEY_WALLET;

  return {
    ...buildPaidEntryAccounting(session, paymentSource),
    isFreeEntry: false,
  };
}

export function toGameCartelaPaymentData(accounting: RegistrationAccounting) {
  return {
    paymentSource: accounting.paymentSource,
    entryFeeCents: accounting.entryFeeCents,
    prizeContributionCents: accounting.prizeContributionCents,
    companyFeeCents: accounting.companyFeeCents,
    companyFeeSource: accounting.companyFeeSource,
  };
}
