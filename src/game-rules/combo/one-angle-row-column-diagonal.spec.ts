import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { ONE_ANGLE_ROW_COLUMN_DIAGONAL_VARIANTS } from './extended-pattern-definitions';
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

describe('ONE_ANGLE_ROW_COLUMN_DIAGONAL', () => {
  const evaluator = new PatternRuleEvaluator();
  const pattern = getRulePattern('ONE_ANGLE_ROW_COLUMN_DIAGONAL');
  const cartela = buildCartela();

  it('exposes four 13-cell corner variants', () => {
    expect(ONE_ANGLE_ROW_COLUMN_DIAGONAL_VARIANTS).toHaveLength(4);
    for (const variant of ONE_ANGLE_ROW_COLUMN_DIAGONAL_VARIANTS) {
      expect(variant).toHaveLength(13);
    }
  });

  it.each([
    ['B1', 0],
    ['O1', 1],
    ['B5', 2],
    ['O5', 3],
  ] as const)('wins for the %s angle', (_label, index) => {
    const result = evaluator.evaluate(
      cartela,
      calledNumbersForCells(ONE_ANGLE_ROW_COLUMN_DIAGONAL_VARIANTS[index]),
      'ONE_ANGLE_ROW_COLUMN_DIAGONAL',
      pattern!,
    );

    expect(result.isWinner).toBe(true);
  });

  it('rejects a MIX_09-style non-corner row+col+diag', () => {
    const row2: Array<[number, number]> = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ];
    const colI: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ];
    const mainDiag: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ];

    const result = evaluator.evaluate(
      cartela,
      calledNumbersForCells([...row2, ...colI, ...mainDiag]),
      'ONE_ANGLE_ROW_COLUMN_DIAGONAL',
      pattern!,
    );

    expect(result.isWinner).toBe(false);
  });
});
