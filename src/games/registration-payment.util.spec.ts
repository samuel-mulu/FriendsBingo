import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCategory,
  Prisma,
} from '@prisma/client';
import {
  buildPaidEntryAccounting,
  centsToDecimal,
  decimalToCents,
  resolveRegistrationAccounting,
} from './registration-payment.util';

describe('registration-payment.util', () => {
  const paidSession = {
    entryFee: new Prisma.Decimal('10'),
    prizePerCartela: new Prisma.Decimal('8'),
    companyFeePerCartela: new Prisma.Decimal('2'),
    gameSlot: {
      category: GameCategory.NORMAL,
    },
  };

  it('converts decimal ETB amounts to cents', () => {
    expect(decimalToCents(new Prisma.Decimal('10'))).toBe(1000);
    expect(centsToDecimal(1000).toString()).toBe('10');
  });

  it('uses bonus cartela payment when balance is available', () => {
    const plan = resolveRegistrationAccounting(paidSession, 3);

    expect(plan.isFreeEntry).toBe(false);
    expect(plan.paymentSource).toBe(CartelaPaymentSource.BONUS_CARTELA);
    expect(plan.entryFeeCents).toBe(1000);
    expect(plan.prizeContributionCents).toBe(800);
    expect(plan.companyFeeCents).toBe(200);
    expect(plan.companyFeeSource).toBe(CompanyFeeSource.BONUS);
  });

  it('uses money wallet payment when bonus balance is zero', () => {
    const plan = resolveRegistrationAccounting(paidSession, 0);

    expect(plan.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
    expect(plan.companyFeeSource).toBe(CompanyFeeSource.MONEY);
  });

  it('builds paid accounting from payment source', () => {
    const accounting = buildPaidEntryAccounting(
      paidSession,
      CartelaPaymentSource.MONEY_WALLET,
    );

    expect(accounting.entryFeeCents).toBe(1000);
    expect(accounting.companyFeeSource).toBe(CompanyFeeSource.MONEY);
  });
});
