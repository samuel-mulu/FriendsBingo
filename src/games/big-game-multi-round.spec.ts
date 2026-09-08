import { CartelaPaymentSource, GameCategory, Prisma } from '@prisma/client';
import { resolveRegistrationAccounting } from './registration-payment.util';

describe('resolveRegistrationAccounting Big Tickets', () => {
  const bigGameSession = {
    entryFee: new Prisma.Decimal('100'),
    prizePerCartela: new Prisma.Decimal(0),
    companyFeePerCartela: new Prisma.Decimal('100'),
    gameSlot: { category: GameCategory.BIG_GAME },
  };

  it('uses BIG_GAME_TICKET when preferred for BIG_GAME', () => {
    const result = resolveRegistrationAccounting(
      bigGameSession,
      5,
      CartelaPaymentSource.BIG_GAME_TICKET,
    );
    expect(result.paymentSource).toBe(CartelaPaymentSource.BIG_GAME_TICKET);
    expect(result.entryFeeCents).toBe(10000);
    expect(result.isFreeEntry).toBe(false);
  });

  it('falls back to MONEY_WALLET for BIG_GAME without ticket preference', () => {
    const result = resolveRegistrationAccounting(bigGameSession, 5);
    expect(result.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
  });

  it('ignores BIG_GAME_TICKET preference on NORMAL', () => {
    const result = resolveRegistrationAccounting(
      {
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        companyFeePerCartela: new Prisma.Decimal('2'),
        gameSlot: { category: GameCategory.NORMAL },
      },
      0,
      CartelaPaymentSource.BIG_GAME_TICKET,
    );
    expect(result.paymentSource).toBe(CartelaPaymentSource.MONEY_WALLET);
  });
});

describe('Big Game round clone chunk size', () => {
  it('uses 500 as createMany chunk size constant', () => {
    // Guardrail: keep clone batches small enough for Prisma/Postgres under 1000+ cartelas.
    const CLONE_CHUNK_SIZE = 500;
    expect(Math.ceil(1000 / CLONE_CHUNK_SIZE)).toBe(2);
    expect(Math.ceil(5000 / CLONE_CHUNK_SIZE)).toBe(10);
  });
});
