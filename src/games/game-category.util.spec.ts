import { GameCategory } from '@prisma/client';
import {
  cartelaPoolForCategory,
  isStandardQueueCategory,
  liveCartelaPoolCategoryFilter,
  sharesCartelaPool,
} from './game-category.util';

describe('cartela pool helpers', () => {
  it('maps NORMAL and BONUS to the standard pool', () => {
    expect(cartelaPoolForCategory(GameCategory.NORMAL)).toBe('standard');
    expect(cartelaPoolForCategory(GameCategory.BONUS)).toBe('standard');
  });

  it('maps BIG_GAME to the bigGame pool', () => {
    expect(cartelaPoolForCategory(GameCategory.BIG_GAME)).toBe('bigGame');
  });

  it('shares pool within standard and within big game only', () => {
    expect(sharesCartelaPool(GameCategory.NORMAL, GameCategory.BONUS)).toBe(
      true,
    );
    expect(sharesCartelaPool(GameCategory.BIG_GAME, GameCategory.BIG_GAME)).toBe(
      true,
    );
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
      in: [GameCategory.NORMAL, GameCategory.BONUS],
    });
  });

  it('treats only BIG_GAME as non-queue category', () => {
    expect(isStandardQueueCategory(GameCategory.NORMAL)).toBe(true);
    expect(isStandardQueueCategory(GameCategory.BONUS)).toBe(true);
    expect(isStandardQueueCategory(GameCategory.BIG_GAME)).toBe(false);
  });
});
