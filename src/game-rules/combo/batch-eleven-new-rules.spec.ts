import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { BIG_T_VARIANTS } from './base-pattern-generator';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';

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

function mainDiag(): Array<[number, number]> {
  return Array.from({ length: 5 }, (_, i) => [i, i]);
}

function antiDiag(): Array<[number, number]> {
  return Array.from({ length: 5 }, (_, i) => [i, 4 - i]);
}

function square(r: number, c: number): Array<[number, number]> {
  return [
    [r, c],
    [r, c + 1],
    [r + 1, c],
    [r + 1, c + 1],
  ];
}

describe('batch of 11 new combo rules', () => {
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

  it('registers all 11 product keys', () => {
    const keys = [
      'BIG_T_ONE_DIAGONAL_ONE_SQUARE',
      'TWO_LINES_TWO_SQUARES',
      'ONE_LINE_THREE_SQUARES',
      'EIGHT_LINES',
      'THREE_ROWS_TWO_COLUMNS',
      'FOUR_ANGLES_TWO_RECTANGLES',
      'TWO_PARALLEL_LINES_TWO_DIAGONALS',
      'THREE_PARALLEL_LINES_ONE_DIAGONAL',
      'BIG_T_THREE_SQUARES',
      'THREE_SMALL_T',
      'BIG_CROSS_ONE_SQUARE',
    ];
    for (const key of keys) {
      expect(getRulePattern(key)).not.toBeNull();
    }
  });

  it('BIG_T_ONE_DIAGONAL_ONE_SQUARE wins with T + anti diag + separate square', () => {
    const result = evaluate('BIG_T_ONE_DIAGONAL_ONE_SQUARE', [
      ...BIG_T_VARIANTS[0],
      ...antiDiag(),
      ...square(3, 3),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('TWO_LINES_TWO_SQUARES wins with overlapping lines and separate squares', () => {
    const result = evaluate('TWO_LINES_TWO_SQUARES', [
      ...row(0),
      ...col(0),
      ...square(3, 1),
      ...square(3, 3),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('ONE_LINE_THREE_SQUARES rejects when a square touches the line', () => {
    const result = evaluate('ONE_LINE_THREE_SQUARES', [
      ...row(4),
      ...square(3, 0),
      ...square(0, 0),
      ...square(0, 3),
    ]);
    expect(result.isWinner).toBe(false);
  });

  it('EIGHT_LINES wins with 5 rows and 3 columns', () => {
    const result = evaluate('EIGHT_LINES', [
      ...row(0),
      ...row(1),
      ...row(2),
      ...row(3),
      ...row(4),
      ...col(0),
      ...col(2),
      ...col(4),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('THREE_ROWS_TWO_COLUMNS wins', () => {
    const result = evaluate('THREE_ROWS_TWO_COLUMNS', [
      ...row(0),
      ...row(1),
      ...row(2),
      ...col(0),
      ...col(4),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('FOUR_ANGLES_TWO_RECTANGLES wins with corners and two separate rectangles', () => {
    const result = evaluate('FOUR_ANGLES_TWO_RECTANGLES', [
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [3, 1],
      [3, 2],
      [4, 1],
      [4, 2],
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('TWO_PARALLEL_LINES_TWO_DIAGONALS wins', () => {
    const result = evaluate('TWO_PARALLEL_LINES_TWO_DIAGONALS', [
      ...row(0),
      ...row(4),
      ...mainDiag(),
      ...antiDiag(),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('THREE_PARALLEL_LINES_ONE_DIAGONAL wins', () => {
    const result = evaluate('THREE_PARALLEL_LINES_ONE_DIAGONAL', [
      ...row(0),
      ...row(1),
      ...row(2),
      ...mainDiag(),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('BIG_T_THREE_SQUARES wins with disjoint squares', () => {
    const result = evaluate('BIG_T_THREE_SQUARES', [
      ...BIG_T_VARIANTS[0],
      ...square(1, 0),
      ...square(3, 0),
      ...square(3, 3),
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('THREE_SMALL_T wins with three separate small Ts', () => {
    const result = evaluate('THREE_SMALL_T', [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 1],
      [2, 0],
      [3, 0],
      [4, 0],
      [3, 1],
      [3, 2],
      [4, 2],
      [4, 3],
      [4, 4],
      [3, 3],
      [2, 3],
    ]);
    expect(result.isWinner).toBe(true);
  });

  it('BIG_CROSS_ONE_SQUARE wins with a corner square', () => {
    const result = evaluate('BIG_CROSS_ONE_SQUARE', [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [0, 2],
      [1, 2],
      [3, 2],
      [4, 2],
      ...square(0, 0),
    ]);
    expect(result.isWinner).toBe(true);
  });
});
