import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCategory,
  Prisma,
} from '@prisma/client';
import { resolveRegistrationAccounting } from './registration-payment.util';

function sessionFor(
  category: GameCategory,
  entryFee = '10',
  prizePerCartela = '8',
) {
  const entry = new Prisma.Decimal(entryFee);
  const prize = new Prisma.Decimal(prizePerCartela);
  return {
    entryFee: entry,
    prizePerCartela: prize,
    companyFeePerCartela: entry.minus(prize),
    gameSlot: { category },
  };
}

describe('resolveRegistrationAccounting', () => {
  it('uses BONUS_CARTELA for NORMAL when bonus balance is available', () => {
    const result = resolveRegistrationAccounting(
      sessionFor(GameCategory.NORMAL),
      10,
    );

    expect(result.isFreeEntry).toBe(false);
    expect(result.paymentSource).toBe(CartelaPaymentSource.BONUS_CARTELA);
    expect(result.companyFeeSource).toBe(CompanyFeeSource.BONUS);
  });

  it('uses MONEY_WALLET for NORMAL when bonus balance is zero', () => {
    const result = resolveRegistrationAccounting(
      sessionFor(GameCategory.NORMAL),
      0,
    );

    expect(result.isFreeEntry).toBe(false);
    expect(result.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
    expect(result.companyFeeSource).toBe(CompanyFeeSource.MONEY);
  });

  it('keeps BONUS games as free entry without consuming bonus cartelas', () => {
    const result = resolveRegistrationAccounting(
      sessionFor(GameCategory.BONUS, '0', '0'),
      10,
    );

    expect(result.isFreeEntry).toBe(true);
    expect(result.paymentSource).toBeNull();
    expect(result.entryFeeCents).toBe(0);
    expect(result.companyFeeSource).toBeNull();
  });

  it('always charges MONEY_WALLET for BIG_GOTD even with bonus balance', () => {
    const result = resolveRegistrationAccounting(
      sessionFor(GameCategory.BIG_GOTD, '20', '0'),
      10,
    );

    expect(result.isFreeEntry).toBe(false);
    expect(result.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
    expect(result.companyFeeSource).toBe(CompanyFeeSource.MONEY);
  });

  it('always charges MONEY_WALLET for BIG_GAME even with bonus balance', () => {
    const result = resolveRegistrationAccounting(
      sessionFor(GameCategory.BIG_GAME, '50', '0'),
      10,
    );

    expect(result.isFreeEntry).toBe(false);
    expect(result.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
    expect(result.companyFeeSource).toBe(CompanyFeeSource.MONEY);
  });
});
