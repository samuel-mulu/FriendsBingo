import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import {
  buildBoardRows,
  getCompletedColumnIndexes,
  getCompletedDiagonalIndexes,
  getCompletedRowIndexes,
  isFullHouse,
  isMarkedCellValue,
} from './board.util';

function createCartela(overrides?: Partial<EvaluatorCartela>): EvaluatorCartela {
  return {
    id: 'cartela-1',
    number: 1,
    b: [7, 13, 10, 9, 4],
    i: [22, 20, 26, 18, 21],
    n: [37, 43, 'FREE', 41, 42],
    g: [56, 51, 57, 60, 53],
    o: [74, 64, 65, 72, 62],
    ...overrides,
  };
}

describe('board.util', () => {
  it('treats FREE as always marked', () => {
    expect(isMarkedCellValue('FREE', new Set())).toBe(true);
  });

  it('marks numeric cells only when called', () => {
    const called = new Set([7, 22]);
    expect(isMarkedCellValue(7, called)).toBe(true);
    expect(isMarkedCellValue(13, called)).toBe(false);
  });

  it('builds a 5x5 board with FREE in the center', () => {
    const rows = buildBoardRows(createCartela());
    expect(rows).toHaveLength(5);
    expect(rows[2][2]).toBe('FREE');
  });
});

describe('row/column/diagonal completion helpers', () => {
  const cartela = createCartela();

  it('detects a completed row', () => {
    const called = new Set([7, 22, 37, 56, 74]);
    expect(getCompletedRowIndexes(cartela, called)).toEqual([1]);
  });

  it('detects a completed column', () => {
    const called = new Set([7, 13, 10, 9, 4]);
    expect(getCompletedColumnIndexes(cartela, called)).toEqual([0]);
  });

  it('detects the main diagonal', () => {
    const called = new Set([7, 20, 41, 60, 62]);
    expect(getCompletedDiagonalIndexes(cartela, called)).toEqual([1]);
  });

  it('detects full house when all rows are complete', () => {
    const called = new Set([
      7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53,
      74, 64, 65, 72, 62,
    ]);
    expect(isFullHouse(cartela, called)).toBe(true);
  });
});
