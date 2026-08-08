import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import { SMALL_CROSS_VARIANTS } from './extended-pattern-definitions';

function cellValue(row: number, col: number): number | string {
  if (row === 2 && col === 2) {
    return 'FREE';
  }
  return col * 15 + row + 1;
}

function buildCartela(): EvaluatorCartela {
  const column = (col: number) =>
    Array.from({ length: 5 }, (_, row) => cellValue(row, col));

  return {
    id: 'cartela-1',
    number: 1,
    b: column(0),
    i: column(1),
    n: column(2),
    g: column(3),
    o: column(4),
  };
}

function calledNumbersForCells(
  cells: Array<[number, number]>,
): CalledNumberEvaluationRecord[] {
  const seen = new Set<number>();
  const records: CalledNumberEvaluationRecord[] = [];

  for (const [row, col] of cells) {
    const value = cellValue(row, col);
    if (typeof value !== 'number' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    records.push({
      number: value,
      letter: ['B', 'I', 'N', 'G', 'O'][col],
      order: records.length + 1,
    });
  }

  return records;
}

function row(r: number): Array<[number, number]> {
  return Array.from({ length: 5 }, (_, c) => [r, c]);
}

function col(c: number): Array<[number, number]> {
  return Array.from({ length: 5 }, (_, r) => [r, c]);
}

function square(r: number, c: number): Array<[number, number]> {
  return [
    [r, c],
    [r, c + 1],
    [r + 1, c],
    [r + 1, c + 1],
  ];
}

describe('batch of 4 new combo rules', () => {
  const evaluator = new PatternRuleEvaluator();
  const cartela = buildCartela();

  function evaluate(ruleKey: string, cells: Array<[number, number]>) {
    return evaluator.evaluate(
      cartela,
      calledNumbersForCells(cells),
      ruleKey,
      getRulePattern(ruleKey)!,
    );
  }

  it('registers all 4 product keys and generates 9 small-cross variants', () => {
    for (const key of [
      'TWO_LINES_FREE_TWO_WITHOUT_FREE',
      'SMALL_CROSS_TRIANGLE_SQUARE',
      'FOUR_LINES_WITHOUT_FREE',
      'THREE_SQUARES_TWO_ANGLES',
    ]) {
      expect(getRulePattern(key)).toBeTruthy();
    }
    expect(SMALL_CROSS_VARIANTS).toHaveLength(9);
  });

  it('TWO_LINES_FREE_TWO_WITHOUT_FREE wins with 2 free + 2 without-free lines', () => {
    const result = evaluate('TWO_LINES_FREE_TWO_WITHOUT_FREE', [
      ...row(2),
      ...col(2),
      ...row(0),
      ...row(4),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('FOUR_LINES_WITHOUT_FREE wins with four non-free lines', () => {
    const result = evaluate('FOUR_LINES_WITHOUT_FREE', [
      ...row(0),
      ...row(1),
      ...row(3),
      ...row(4),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('FOUR_LINES_WITHOUT_FREE rejects when a free-touching line is needed', () => {
    const result = evaluate('FOUR_LINES_WITHOUT_FREE', [
      ...row(0),
      ...row(1),
      ...row(2),
      ...row(4),
    ]);
    expect(result.isWinner).toBe(false);
  });

  it('SMALL_CROSS_TRIANGLE_SQUARE wins with disjoint pieces', () => {
    const result = evaluate('SMALL_CROSS_TRIANGLE_SQUARE', [
      [1, 2],
      [2, 1],
      [2, 2],
      [2, 3],
      [3, 2],
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 0],
      ...square(3, 3),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('SMALL_CROSS_TRIANGLE_SQUARE rejects overlapping square on the cross', () => {
    const result = evaluate('SMALL_CROSS_TRIANGLE_SQUARE', [
      [1, 2],
      [2, 1],
      [2, 2],
      [2, 3],
      [3, 2],
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 0],
      ...square(1, 1),
    ]);
    expect(result.isWinner).toBe(false);
  });

  it('THREE_SQUARES_TWO_ANGLES wins with disjoint squares and corners', () => {
    const result = evaluate('THREE_SQUARES_TWO_ANGLES', [
      ...square(0, 1),
      ...square(1, 3),
      ...square(3, 1),
      [0, 0],
      [4, 4],
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('THREE_SQUARES_TWO_ANGLES rejects when an angle sits inside a square', () => {
    const result = evaluate('THREE_SQUARES_TWO_ANGLES', [
      ...square(0, 0),
      ...square(1, 3),
      ...square(3, 1),
      [0, 0],
      [4, 4],
    ]);
    expect(result.isWinner).toBe(false);
  });
});
