import { GameCategory } from '@prisma/client';
import {
  remainingCategoryCartelaSlots,
  categoryCartelaLimitError,
  exposedMaxCartelasPerPlayer,
} from './game-category.util';

describe('remainingCategoryCartelaSlots', () => {
  it('does not cap NORMAL games when max is omitted', () => {
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.NORMAL,
        existingCount: 20,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('caps NORMAL games when maxCartelasPerPlayer is set', () => {
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.NORMAL,
        maxCartelasPerPlayer: 5,
        existingCount: 2,
      }),
    ).toBe(3);
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.NORMAL,
        maxCartelasPerPlayer: 5,
        existingCount: 5,
      }),
    ).toBe(0);
  });

  it('does not cap BIG_GAME even when a stored max is present', () => {
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.BIG_GAME,
        maxCartelasPerPlayer: 5,
        existingCount: 20,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('caps CHAIN_GAME by maxCartelasPerPlayer', () => {
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.CHAIN_GAME,
        maxCartelasPerPlayer: 5,
        existingCount: 0,
      }),
    ).toBe(5);
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.CHAIN_GAME,
        maxCartelasPerPlayer: 5,
        existingCount: 5,
      }),
    ).toBe(0);
  });

  it('caps bonus-like games with the bonus default when max is omitted', () => {
    expect(
      remainingCategoryCartelaSlots({
        category: GameCategory.BONUS,
        existingCount: 2,
      }),
    ).toBe(3);
  });
});

describe('categoryCartelaLimitError', () => {
  it('uses a Chain Game code so clients can show the max-cartela message', () => {
    expect(categoryCartelaLimitError(GameCategory.CHAIN_GAME)).toEqual({
      message: 'Chain Game cartela limit reached for this session',
      code: 'CHAIN_GAME_CARTELA_LIMIT_REACHED',
    });
  });

  it('uses a Normal Game code when the slot has a per-player cap', () => {
    expect(categoryCartelaLimitError(GameCategory.NORMAL)).toEqual({
      message: 'Normal game cartela limit reached for this session',
      code: 'NORMAL_CARTELA_LIMIT_REACHED',
    });
  });
});

describe('exposedMaxCartelasPerPlayer', () => {
  it('hides the cap for BIG_GAME', () => {
    expect(exposedMaxCartelasPerPlayer(GameCategory.BIG_GAME, 20)).toBeNull();
  });

  it('passes through CHAIN_GAME and bonus-like caps', () => {
    expect(exposedMaxCartelasPerPlayer(GameCategory.CHAIN_GAME, 10)).toBe(10);
    expect(exposedMaxCartelasPerPlayer(GameCategory.BONUS, 5)).toBe(5);
  });
});
