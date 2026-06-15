import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { ComboRuleEvaluator } from './combo-rule.evaluator';
import {
  HALF_HOUSE_10_DIRECTION_VARIANTS,
  HALF_HOUSE_4_DIRECTION_VARIANTS,
} from './half-house-pattern-definitions';
import { BoardCoord } from '../patterns/pattern.types';

function createCartela(): EvaluatorCartela {
  return {
    id: 'cartela-1',
    number: 1,
    b: [7, 13, 10, 9, 4],
    i: [22, 20, 26, 18, 21],
    n: [37, 43, 'FREE', 41, 42],
    g: [56, 51, 57, 60, 53],
    o: [74, 64, 65, 72, 62],
  };
}

function called(numbers: number[]): CalledNumberRecord[] {
  return numbers.map((number, index) => ({
    id: `called-${number}`,
    gameSessionId: 'session-1',
    letter: 'B',
    number,
    order: index + 1,
    createdAt: new Date('2026-06-08T10:00:00.000Z'),
  }));
}

function cellNumber(
  cartela: EvaluatorCartela,
  row: number,
  col: number,
): number | null {
  const columns = [cartela.b, cartela.i, cartela.n, cartela.g, cartela.o];
  const value = columns[col]?.[row];
  if (typeof value === 'string') {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  return null;
}

function numbersForCells(
  cartela: EvaluatorCartela,
  cells: BoardCoord[],
): number[] {
  const numbers = cells
    .map(([row, col]) => cellNumber(cartela, row, col))
    .filter((value): value is number => value !== null);

  return [...new Set(numbers)];
}

describe('Half house combo rules', () => {
  const evaluator = new ComboRuleEvaluator();
  const cartela = createCartela();
  const pattern10 = getRulePattern('HALF_HOUSE_10_DIRECTIONS')!;
  const pattern4 = getRulePattern('HALF_HOUSE_4_DIRECTIONS')!;

  describe('HALF_HOUSE_10_DIRECTIONS', () => {
    it.each(Object.entries(HALF_HOUSE_10_DIRECTION_VARIANTS))(
      'wins when %s is complete',
      (shapeName, cells) => {
        const numbers = numbersForCells(cartela, cells);
        const result = evaluator.evaluate(
          cartela,
          called(numbers),
          'HALF_HOUSE_10_DIRECTIONS',
          pattern10,
        );

        expect(result.isWinner).toBe(true);
        expect(result.completedByLatestNumber).toBe(true);
      },
    );

    it('rejects incomplete half-house patterns', () => {
      const partial = numbersForCells(
        cartela,
        HALF_HOUSE_10_DIRECTION_VARIANTS.TOP_3_ROWS.slice(0, 10),
      );

      expect(
        evaluator.evaluate(
          cartela,
          called(partial),
          'HALF_HOUSE_10_DIRECTIONS',
          pattern10,
        ).isWinner,
      ).toBe(false);
    });

    it('accepts claim when latest draw completes the pattern', () => {
      const cells = HALF_HOUSE_10_DIRECTION_VARIANTS.TOP_3_ROWS;
      const allNumbers = numbersForCells(cartela, cells);
      const latest = allNumbers[allNumbers.length - 1];
      const beforeLatest = allNumbers.slice(0, -1);

      expect(
        evaluator.evaluate(
          cartela,
          called(beforeLatest),
          'HALF_HOUSE_10_DIRECTIONS',
          pattern10,
        ).isWinner,
      ).toBe(false);

      const result = evaluator.evaluate(
        cartela,
        called(allNumbers),
        'HALF_HOUSE_10_DIRECTIONS',
        pattern10,
      );

      expect(result.isWinner).toBe(true);
      expect(result.latestCalledNumber).toBe(latest);
      expect(result.completedByLatestNumber).toBe(true);
    });

    it('rejects late claim when pattern was already complete before latest draw', () => {
      const numbers = numbersForCells(
        cartela,
        HALF_HOUSE_10_DIRECTION_VARIANTS.TOP_3_ROWS,
      );
      const result = evaluator.evaluate(
        cartela,
        called([...numbers, 99]),
        'HALF_HOUSE_10_DIRECTIONS',
        pattern10,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(false);
    });
  });

  describe('HALF_HOUSE_4_DIRECTIONS', () => {
    it.each(Object.entries(HALF_HOUSE_4_DIRECTION_VARIANTS))(
      'wins when %s is complete',
      (shapeName, cells) => {
        const numbers = numbersForCells(cartela, cells);
        const result = evaluator.evaluate(
          cartela,
          called(numbers),
          'HALF_HOUSE_4_DIRECTIONS',
          pattern4,
        );

        expect(result.isWinner).toBe(true);
        expect(result.completedByLatestNumber).toBe(true);
      },
    );

    it('rejects incomplete diagonal half-house patterns', () => {
      const partial = numbersForCells(
        cartela,
        HALF_HOUSE_4_DIRECTION_VARIANTS.TOP_LEFT_HALF.slice(0, 8),
      );

      expect(
        evaluator.evaluate(
          cartela,
          called(partial),
          'HALF_HOUSE_4_DIRECTIONS',
          pattern4,
        ).isWinner,
      ).toBe(false);
    });

    it('accepts claim when latest draw completes the pattern', () => {
      const cells = HALF_HOUSE_4_DIRECTION_VARIANTS.BOTTOM_LEFT_HALF;
      const allNumbers = numbersForCells(cartela, cells);
      const beforeLatest = allNumbers.slice(0, -1);

      expect(
        evaluator.evaluate(
          cartela,
          called(beforeLatest),
          'HALF_HOUSE_4_DIRECTIONS',
          pattern4,
        ).isWinner,
      ).toBe(false);

      const result = evaluator.evaluate(
        cartela,
        called(allNumbers),
        'HALF_HOUSE_4_DIRECTIONS',
        pattern4,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
    });

    it('rejects late claim when pattern was already complete before latest draw', () => {
      const numbers = numbersForCells(
        cartela,
        HALF_HOUSE_4_DIRECTION_VARIANTS.TOP_RIGHT_HALF,
      );
      const result = evaluator.evaluate(
        cartela,
        called([...numbers, 99]),
        'HALF_HOUSE_4_DIRECTIONS',
        pattern4,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(false);
    });
  });
});
