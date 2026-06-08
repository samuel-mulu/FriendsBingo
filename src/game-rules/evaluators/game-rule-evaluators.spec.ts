import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { ColumnsRuleEvaluator } from './columns-rule.evaluator';
import { DiagonalRuleEvaluator } from './diagonal-rule.evaluator';
import { FullHouseRuleEvaluator } from './full-house-rule.evaluator';
import { HalfHouseRuleEvaluator } from './half-house-rule.evaluator';
import { LineRuleEvaluator } from './line-rule.evaluator';
import { RowsRuleEvaluator } from './rows-rule.evaluator';

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

describe('game rule evaluators', () => {
  const cartela = createCartela();

  it('FULL_HOUSE wins only when every row is complete', () => {
    const evaluator = new FullHouseRuleEvaluator();
    const partial = called([7, 13, 10, 9, 4]);
    const full = called([
      7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53,
      74, 64, 65, 72, 62,
    ]);

    expect(evaluator.evaluate(cartela, partial, 'FULL_HOUSE').isWinner).toBe(
      false,
    );
    expect(evaluator.evaluate(cartela, full, 'FULL_HOUSE').isWinner).toBe(true);
  });

  it('LINE wins with a row, column, or diagonal', () => {
    const evaluator = new LineRuleEvaluator();
    expect(
      evaluator.evaluate(cartela, called([7, 22, 37, 56, 74]), 'LINE').isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7, 13, 10, 9, 4]), 'LINE').isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7, 20, 41, 60, 62]), 'LINE').isWinner,
    ).toBe(true);
    expect(evaluator.evaluate(cartela, called([7]), 'LINE').isWinner).toBe(false);
  });

  it('ROWS wins with at least one complete row', () => {
    const evaluator = new RowsRuleEvaluator();
    expect(
      evaluator.evaluate(cartela, called([7, 22, 37, 56, 74]), 'ROWS').isWinner,
    ).toBe(true);
    expect(evaluator.evaluate(cartela, called([7]), 'ROWS').isWinner).toBe(
      false,
    );
  });

  it('COLUMNS wins with at least one complete column', () => {
    const evaluator = new ColumnsRuleEvaluator();
    expect(
      evaluator.evaluate(
        cartela,
        called([7, 13, 10, 9, 4]),
        'COLUMNS',
      ).isWinner,
    ).toBe(true);
    expect(evaluator.evaluate(cartela, called([7]), 'COLUMNS').isWinner).toBe(
      false,
    );
  });

  it('DIAGONAL wins with either diagonal complete', () => {
    const evaluator = new DiagonalRuleEvaluator();
    expect(
      evaluator.evaluate(
        cartela,
        called([7, 20, 41, 60, 62]),
        'DIAGONAL',
      ).isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7]), 'DIAGONAL').isWinner,
    ).toBe(false);
  });

  it('HALF_HOUSE wins with three complete rows', () => {
    const evaluator = new HalfHouseRuleEvaluator();
    const twoRows = called([
      7, 22, 37, 56, 74, 13, 20, 43, 51, 64,
    ]);
    const threeRows = called([
      7, 22, 37, 56, 74, 13, 20, 43, 51, 64, 10, 26, 41, 57, 65,
    ]);

    expect(
      evaluator.evaluate(cartela, twoRows, 'HALF_HOUSE').isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, threeRows, 'HALF_HOUSE').isWinner,
    ).toBe(true);
  });
});
