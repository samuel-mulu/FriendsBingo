import {
  BIG_H_VARIANTS,
  BIG_L_VARIANTS,
  BIG_T_VARIANTS,
} from './base-pattern-generator';
import { BoardCoord } from '../patterns/pattern.types';

function toIndexes(coords: BoardCoord[]): number[] {
  return coords.map(([row, col]) => row * 5 + col).sort((left, right) => left - right);
}

describe('BIG shape variants', () => {
  it('BIG_T has four 9-cell orientations', () => {
    expect(BIG_T_VARIANTS).toHaveLength(4);
    expect(toIndexes(BIG_T_VARIANTS[0])).toEqual([0, 1, 2, 3, 4, 7, 12, 17, 22]);
    expect(toIndexes(BIG_T_VARIANTS[1])).toEqual([
      2, 7, 12, 17, 20, 21, 22, 23, 24,
    ]);
    expect(toIndexes(BIG_T_VARIANTS[2])).toEqual([
      0, 5, 10, 11, 12, 13, 14, 15, 20,
    ]);
    expect(toIndexes(BIG_T_VARIANTS[3])).toEqual([
      4, 9, 10, 11, 12, 13, 14, 19, 24,
    ]);
  });

  it('BIG_L has four 9-cell orientations', () => {
    expect(BIG_L_VARIANTS).toHaveLength(4);
    expect(toIndexes(BIG_L_VARIANTS[0])).toEqual([
      0, 5, 10, 15, 20, 21, 22, 23, 24,
    ]);
    expect(toIndexes(BIG_L_VARIANTS[1])).toEqual([
      4, 9, 14, 19, 20, 21, 22, 23, 24,
    ]);
    expect(toIndexes(BIG_L_VARIANTS[2])).toEqual([0, 1, 2, 3, 4, 5, 10, 15, 20]);
    expect(toIndexes(BIG_L_VARIANTS[3])).toEqual([0, 1, 2, 3, 4, 9, 14, 19, 24]);
  });

  it('BIG_H has two 13-cell orientations', () => {
    expect(BIG_H_VARIANTS).toHaveLength(2);
    expect(toIndexes(BIG_H_VARIANTS[0])).toEqual([
      0, 4, 5, 9, 10, 11, 12, 13, 14, 15, 19, 20, 24,
    ]);
    expect(toIndexes(BIG_H_VARIANTS[1])).toEqual([
      0, 1, 2, 3, 4, 7, 12, 17, 20, 21, 22, 23, 24,
    ]);
  });
});
