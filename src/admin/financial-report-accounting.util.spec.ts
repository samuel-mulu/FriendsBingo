import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCategory,
  Prisma,
} from '@prisma/client';
import {
  computeFinancialRevenue,
  type PrizeFinancialRecord,
  type RegistrationFinancialRecord,
} from './financial-report-accounting.util';

const occurredAt = new Date('2026-08-27T12:00:00.000Z');

function normalRegistration(
  overrides: Partial<RegistrationFinancialRecord> = {},
): RegistrationFinancialRecord {
  return {
    category: GameCategory.NORMAL,
    paymentSource: CartelaPaymentSource.MONEY_WALLET,
    companyFeeSource: CompanyFeeSource.MONEY,
    entryFeeCents: 1000,
    companyFeeCents: 200,
    occurredAt,
    ...overrides,
  };
}

function prize(
  category: GameCategory,
  amount: string,
): PrizeFinancialRecord {
  return {
    category,
    amount: new Prisma.Decimal(amount),
    occurredAt,
  };
}

describe('financial-report-accounting.util', () => {
  it('scenario A: NORMAL money-wallet commission counts as company fee and net revenue', () => {
    const registrations = Array.from({ length: 5 }, () => normalRegistration());
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.NORMAL, '40'),
    ]);

    expect(result.companyFeeTotal.toString()).toBe('10');
    expect(result.netRevenue.toString()).toBe('10');
  });

  it('scenario B: NORMAL bonus-cartela registrations are excluded from revenue', () => {
    const registrations = Array.from({ length: 5 }, () =>
      normalRegistration({
        paymentSource: CartelaPaymentSource.BONUS_CARTELA,
        companyFeeSource: CompanyFeeSource.BONUS,
      }),
    );
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.NORMAL, '40'),
    ]);

    expect(result.companyFeeTotal.toString()).toBe('0');
    expect(result.netRevenue.toString()).toBe('0');
  });

  it('scenario C: BONUS prizes reduce net revenue', () => {
    const result = computeFinancialRevenue([], [prize(GameCategory.BONUS, '100')]);

    expect(result.companyFeeTotal.toString()).toBe('0');
    expect(result.netRevenue.toString()).toBe('-100');
    expect(result.bonusPrizeCostTotal.toString()).toBe('100');
  });

  it('scenario D: BIG_GOTD net revenue is money entries minus prize', () => {
    const registrations = Array.from({ length: 10 }, () =>
      normalRegistration({
        category: GameCategory.BIG_GOTD,
        entryFeeCents: 2000,
        companyFeeCents: 2000,
      }),
    );
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.BIG_GOTD, '150'),
    ]);

    expect(result.companyFeeTotal.toString()).toBe('0');
    expect(result.netRevenue.toString()).toBe('50');
  });

  it('scenario E: BIG_GAME uses the same entries-minus-prize rule', () => {
    const registrations = Array.from({ length: 4 }, () =>
      normalRegistration({
        category: GameCategory.BIG_GAME,
        entryFeeCents: 5000,
        companyFeeCents: 5000,
      }),
    );
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.BIG_GAME, '120'),
    ]);

    expect(result.companyFeeTotal.toString()).toBe('0');
    expect(result.netRevenue.toString()).toBe('80');
  });

  it('scenario F: BIG_GAME_TICKET registrations count as Big Game entry revenue', () => {
    const registrations = Array.from({ length: 2 }, () =>
      normalRegistration({
        category: GameCategory.BIG_GAME,
        paymentSource: CartelaPaymentSource.BIG_GAME_TICKET,
        entryFeeCents: 10000,
        companyFeeCents: 10000,
      }),
    );
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.BIG_GAME, '50'),
    ]);

    expect(result.bigGameEntryTotal.toString()).toBe('200');
    expect(result.netRevenue.toString()).toBe('150');
  });

  it('scenario G: CHAIN_GAME net is paid entries minus actually-paid round prizes (forfeited rounds excluded)', () => {
    const registrations = Array.from({ length: 4 }, () =>
      normalRegistration({
        category: GameCategory.CHAIN_GAME,
        entryFeeCents: 2500,
        companyFeeCents: 2500,
      }),
    );
    const result = computeFinancialRevenue(registrations, [
      prize(GameCategory.CHAIN_GAME, '50'),
    ]);

    expect(result.chainGameEntryTotal.toString()).toBe('100');
    expect(result.chainGamePrizeTotal.toString()).toBe('50');
    expect(result.netRevenue.toString()).toBe('50');
    expect(result.companyFeeTotal.toString()).toBe('0');
  });
});
