import { GameCategory } from '@prisma/client';
import {
  DEFAULT_BONUS_MAX_CARTELAS_PER_PLAYER,
  resolvePerPlayerCartelaLimit,
} from './game-category.util';

describe('resolvePerPlayerCartelaLimit', () => {
  it('defaults BONUS and BIG_GOTD to 5 when unset', () => {
    expect(resolvePerPlayerCartelaLimit(GameCategory.BONUS, null)).toBe(
      DEFAULT_BONUS_MAX_CARTELAS_PER_PLAYER,
    );
    expect(resolvePerPlayerCartelaLimit(GameCategory.BIG_GOTD, undefined)).toBe(
      DEFAULT_BONUS_MAX_CARTELAS_PER_PLAYER,
    );
  });

  it('uses explicit BONUS/BIG_GOTD limits', () => {
    expect(resolvePerPlayerCartelaLimit(GameCategory.BONUS, 8)).toBe(8);
    expect(resolvePerPlayerCartelaLimit(GameCategory.BIG_GOTD, 3)).toBe(3);
  });

  it('requires an explicit BIG_GAME or NORMAL limit', () => {
    expect(resolvePerPlayerCartelaLimit(GameCategory.BIG_GAME, null)).toBeNull();
    expect(resolvePerPlayerCartelaLimit(GameCategory.NORMAL, null)).toBeNull();
    expect(resolvePerPlayerCartelaLimit(GameCategory.BIG_GAME, 20)).toBe(20);
    expect(resolvePerPlayerCartelaLimit(GameCategory.NORMAL, 10)).toBe(10);
  });
});
