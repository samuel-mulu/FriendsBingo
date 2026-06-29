import { GameCategory } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  buildSessionMoneyConfig,
  cartelaPoolForCategory,
  isStandardQueueCategory,
  liveCartelaPoolCategoryFilter,
  sharesCartelaPool,
} from './game-category.util';

describe('cartela pool helpers', () => {
  it('maps NORMAL, BONUS, and BIG_GOTD to the standard pool', () => {
    expect(cartelaPoolForCategory(GameCategory.NORMAL)).toBe('standard');
    expect(cartelaPoolForCategory(GameCategory.BONUS)).toBe('standard');
    expect(cartelaPoolForCategory(GameCategory.BIG_GOTD)).toBe('standard');
  });

  it('maps BIG_GAME to the bigGame pool', () => {
    expect(cartelaPoolForCategory(GameCategory.BIG_GAME)).toBe('bigGame');
  });

  it('shares pool within standard and within big game only', () => {
    expect(sharesCartelaPool(GameCategory.NORMAL, GameCategory.BONUS)).toBe(
      true,
    );
    expect(sharesCartelaPool(GameCategory.NORMAL, GameCategory.BIG_GOTD)).toBe(
      true,
    );
    expect(
      sharesCartelaPool(GameCategory.BIG_GAME, GameCategory.BIG_GAME),
    ).toBe(true);
    expect(sharesCartelaPool(GameCategory.NORMAL, GameCategory.BIG_GAME)).toBe(
      false,
    );
    expect(sharesCartelaPool(GameCategory.BONUS, GameCategory.BIG_GAME)).toBe(
      false,
    );
  });

  it('builds prisma category filters per pool', () => {
    expect(liveCartelaPoolCategoryFilter('bigGame')).toBe(
      GameCategory.BIG_GAME,
    );
    expect(liveCartelaPoolCategoryFilter('standard')).toEqual({
      in: [GameCategory.NORMAL, GameCategory.BONUS, GameCategory.BIG_GOTD],
    });
  });

  it('treats only BIG_GAME as non-queue category', () => {
    expect(isStandardQueueCategory(GameCategory.NORMAL)).toBe(true);
    expect(isStandardQueueCategory(GameCategory.BONUS)).toBe(true);
    expect(isStandardQueueCategory(GameCategory.BIG_GOTD)).toBe(true);
    expect(isStandardQueueCategory(GameCategory.BIG_GAME)).toBe(false);
  });

  it('keeps fixed prize while charging entry for BIG_GOTD sessions', () => {
    const config = buildSessionMoneyConfig({
      entryFee: new Prisma.Decimal('25'),
      prizePerCartela: new Prisma.Decimal('0'),
      category: GameCategory.BIG_GOTD,
      fixedPrizeAmount: new Prisma.Decimal('5000'),
    });

    expect(config.entryFee.toString()).toBe('25');
    expect(config.prizePerCartela.toString()).toBe('0');
    expect(config.companyFeePerCartela.toString()).toBe('25');
    expect(config.prizeAmount.toString()).toBe('5000');
    expect(config.companyRevenue.toString()).toBe('0');
  });
});
