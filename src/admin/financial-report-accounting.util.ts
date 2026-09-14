import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCategory,
  Prisma,
} from '@prisma/client';
import { centsToDecimal } from '../games/registration-payment.util';

export type RegistrationFinancialRecord = {
  category: GameCategory;
  paymentSource: CartelaPaymentSource | null;
  companyFeeSource: CompanyFeeSource | null;
  entryFeeCents: number;
  companyFeeCents: number;
  occurredAt: Date;
};

export type PrizeFinancialRecord = {
  category: GameCategory;
  amount: Prisma.Decimal;
  occurredAt: Date;
};

export type RegistrationPromotionalTotals = {
  realEntryFeeTotal: Prisma.Decimal;
  bonusEntryValueTotal: Prisma.Decimal;
  realCompanyFeeTotal: Prisma.Decimal;
  bonusCompanyFeeTotal: Prisma.Decimal;
  bonusCartelasUsed: number;
};

export type FinancialRevenueBreakdown = {
  normalCompanyFeeTotal: Prisma.Decimal;
  bonusPrizeCostTotal: Prisma.Decimal;
  bigGotdEntryTotal: Prisma.Decimal;
  bigGotdPrizeTotal: Prisma.Decimal;
  bigGameEntryTotal: Prisma.Decimal;
  bigGamePrizeTotal: Prisma.Decimal;
  chainGameEntryTotal: Prisma.Decimal;
  chainGamePrizeTotal: Prisma.Decimal;
  netRevenue: Prisma.Decimal;
  companyFeeTotal: Prisma.Decimal;
};

export type FinancialRevenueBreakdownResponse = {
  normalCommission: string;
  bonusPrizeCost: string;
  bigGotdNet: string;
  bigGameNet: string;
  chainGameNet: string;
};

const ZERO = new Prisma.Decimal(0);

function isMoneyWalletRegistration(
  paymentSource: CartelaPaymentSource | null,
): boolean {
  return paymentSource === CartelaPaymentSource.MONEY_WALLET;
}

/** Paid Big Game entries: wallet money or Big Ticket spend (force-funded). */
function isBigGamePaidRegistration(
  paymentSource: CartelaPaymentSource | null,
): boolean {
  return (
    paymentSource === CartelaPaymentSource.MONEY_WALLET ||
    paymentSource === CartelaPaymentSource.BIG_GAME_TICKET
  );
}

export function emptyFinancialRevenueBreakdown(): FinancialRevenueBreakdown {
  return {
    normalCompanyFeeTotal: ZERO,
    bonusPrizeCostTotal: ZERO,
    bigGotdEntryTotal: ZERO,
    bigGotdPrizeTotal: ZERO,
    bigGameEntryTotal: ZERO,
    bigGamePrizeTotal: ZERO,
    chainGameEntryTotal: ZERO,
    chainGamePrizeTotal: ZERO,
    netRevenue: ZERO,
    companyFeeTotal: ZERO,
  };
}

export function sumRegistrationRevenue(
  records: RegistrationFinancialRecord[],
): Pick<
  FinancialRevenueBreakdown,
  | 'normalCompanyFeeTotal'
  | 'bigGotdEntryTotal'
  | 'bigGameEntryTotal'
  | 'chainGameEntryTotal'
> {
  return records.reduce(
    (totals, record) => {
      if (
        record.category === GameCategory.NORMAL &&
        isMoneyWalletRegistration(record.paymentSource) &&
        record.companyFeeSource === CompanyFeeSource.MONEY
      ) {
        totals.normalCompanyFeeTotal = totals.normalCompanyFeeTotal.plus(
          centsToDecimal(record.companyFeeCents),
        );
      }

      if (
        record.category === GameCategory.BIG_GOTD &&
        isMoneyWalletRegistration(record.paymentSource)
      ) {
        totals.bigGotdEntryTotal = totals.bigGotdEntryTotal.plus(
          centsToDecimal(record.entryFeeCents),
        );
      }

      if (
        record.category === GameCategory.BIG_GAME &&
        isBigGamePaidRegistration(record.paymentSource)
      ) {
        totals.bigGameEntryTotal = totals.bigGameEntryTotal.plus(
          centsToDecimal(record.entryFeeCents),
        );
      }

      // Chain Game uses the Big GOTD economics: paid wallet entry is company
      // revenue, prizes come from the configured pool.
      if (
        record.category === GameCategory.CHAIN_GAME &&
        isMoneyWalletRegistration(record.paymentSource)
      ) {
        totals.chainGameEntryTotal = totals.chainGameEntryTotal.plus(
          centsToDecimal(record.entryFeeCents),
        );
      }

      return totals;
    },
    {
      normalCompanyFeeTotal: ZERO,
      bigGotdEntryTotal: ZERO,
      bigGameEntryTotal: ZERO,
      chainGameEntryTotal: ZERO,
    },
  );
}

export function sumPrizeRevenue(records: PrizeFinancialRecord[]): Pick<
  FinancialRevenueBreakdown,
  | 'bonusPrizeCostTotal'
  | 'bigGotdPrizeTotal'
  | 'bigGamePrizeTotal'
  | 'chainGamePrizeTotal'
> {
  return records.reduce(
    (totals, record) => {
      if (record.category === GameCategory.BONUS) {
        totals.bonusPrizeCostTotal = totals.bonusPrizeCostTotal.plus(
          record.amount,
        );
      }

      if (record.category === GameCategory.BIG_GOTD) {
        totals.bigGotdPrizeTotal = totals.bigGotdPrizeTotal.plus(record.amount);
      }

      if (record.category === GameCategory.BIG_GAME) {
        totals.bigGamePrizeTotal = totals.bigGamePrizeTotal.plus(record.amount);
      }

      // Chain Game pays one PRIZE_WIN transaction per round, so this naturally
      // sums to only the rounds that were actually won.
      if (record.category === GameCategory.CHAIN_GAME) {
        totals.chainGamePrizeTotal = totals.chainGamePrizeTotal.plus(
          record.amount,
        );
      }

      return totals;
    },
    {
      bonusPrizeCostTotal: ZERO,
      bigGotdPrizeTotal: ZERO,
      bigGamePrizeTotal: ZERO,
      chainGamePrizeTotal: ZERO,
    },
  );
}

export function computeFinancialRevenue(
  registrations: RegistrationFinancialRecord[],
  prizes: PrizeFinancialRecord[],
): FinancialRevenueBreakdown {
  const registrationTotals = sumRegistrationRevenue(registrations);
  const prizeTotals = sumPrizeRevenue(prizes);

  const bigGotdNet = registrationTotals.bigGotdEntryTotal.minus(
    prizeTotals.bigGotdPrizeTotal,
  );
  const bigGameNet = registrationTotals.bigGameEntryTotal.minus(
    prizeTotals.bigGamePrizeTotal,
  );
  const chainGameNet = registrationTotals.chainGameEntryTotal.minus(
    prizeTotals.chainGamePrizeTotal,
  );

  const netRevenue = registrationTotals.normalCompanyFeeTotal
    .minus(prizeTotals.bonusPrizeCostTotal)
    .plus(bigGotdNet)
    .plus(bigGameNet)
    .plus(chainGameNet);

  return {
    normalCompanyFeeTotal: registrationTotals.normalCompanyFeeTotal,
    bonusPrizeCostTotal: prizeTotals.bonusPrizeCostTotal,
    bigGotdEntryTotal: registrationTotals.bigGotdEntryTotal,
    bigGotdPrizeTotal: prizeTotals.bigGotdPrizeTotal,
    bigGameEntryTotal: registrationTotals.bigGameEntryTotal,
    bigGamePrizeTotal: prizeTotals.bigGamePrizeTotal,
    chainGameEntryTotal: registrationTotals.chainGameEntryTotal,
    chainGamePrizeTotal: prizeTotals.chainGamePrizeTotal,
    netRevenue,
    companyFeeTotal: registrationTotals.normalCompanyFeeTotal,
  };
}

export function computeProfitNet(
  netRevenue: Prisma.Decimal,
  expensesTotal: Prisma.Decimal,
): Prisma.Decimal {
  return netRevenue.minus(expensesTotal);
}

export function serializeRevenueBreakdown(
  breakdown: FinancialRevenueBreakdown,
): FinancialRevenueBreakdownResponse {
  return {
    normalCommission: breakdown.normalCompanyFeeTotal.toString(),
    bonusPrizeCost: breakdown.bonusPrizeCostTotal.toString(),
    bigGotdNet: breakdown.bigGotdEntryTotal
      .minus(breakdown.bigGotdPrizeTotal)
      .toString(),
    bigGameNet: breakdown.bigGameEntryTotal
      .minus(breakdown.bigGamePrizeTotal)
      .toString(),
    chainGameNet: breakdown.chainGameEntryTotal
      .minus(breakdown.chainGamePrizeTotal)
      .toString(),
  };
}

export function sumRegistrationPromotionalTotals(
  records: RegistrationFinancialRecord[],
): RegistrationPromotionalTotals {
  return records.reduce(
    (totals, record) => {
      if (record.paymentSource === CartelaPaymentSource.BONUS_CARTELA) {
        totals.bonusCartelasUsed += 1;
        totals.bonusEntryValueTotal = totals.bonusEntryValueTotal.plus(
          centsToDecimal(record.entryFeeCents),
        );
      } else if (record.paymentSource === CartelaPaymentSource.MONEY_WALLET) {
        totals.realEntryFeeTotal = totals.realEntryFeeTotal.plus(
          centsToDecimal(record.entryFeeCents),
        );
      }

      if (record.companyFeeSource === CompanyFeeSource.BONUS) {
        totals.bonusCompanyFeeTotal = totals.bonusCompanyFeeTotal.plus(
          centsToDecimal(record.companyFeeCents),
        );
      } else if (record.companyFeeSource === CompanyFeeSource.MONEY) {
        totals.realCompanyFeeTotal = totals.realCompanyFeeTotal.plus(
          centsToDecimal(record.companyFeeCents),
        );
      }

      return totals;
    },
    {
      realEntryFeeTotal: ZERO,
      bonusEntryValueTotal: ZERO,
      realCompanyFeeTotal: ZERO,
      bonusCompanyFeeTotal: ZERO,
      bonusCartelasUsed: 0,
    },
  );
}
