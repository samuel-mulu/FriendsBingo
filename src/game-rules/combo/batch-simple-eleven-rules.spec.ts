import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
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

function square(r: number, c: number): Array<[number, number]> {
  return [
    [r, c],
    [r, c + 1],
    [r + 1, c],
    [r + 1, c + 1],
  ];
}

function rectangle2x3(r: number, c: number): Array<[number, number]> {
  return [
    [r, c],
    [r, c + 1],
    [r, c + 2],
    [r + 1, c],
    [r + 1, c + 1],
    [r + 1, c + 2],
  ];
}

describe('batch of 11 simple combo rules', () => {
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

  const keys = [
    'ONE_DIAGONAL',
    'ONE_SQUARE',
    'TWO_SQUARES',
    'ONE_ROW_ONE_COLUMN',
    'ONE_RECTANGLE',
    'ONE_LINE_TOUCH_FREE',
    'ONE_LINE_WITHOUT_FREE',
    'ONE_COLUMN',
    'TWO_COLUMNS',
    'ONE_ROW',
    'TWO_ROWS',
  ] as const;

  it('registers all 11 product keys', () => {
    for (const key of keys) {
      expect(getRulePattern(key)).not.toBeNull();
    }
  });

  it('ONE_DIAGONAL wins with main diagonal', () => {
    expect(evaluate('ONE_DIAGONAL', mainDiag()).isWinner).toBe(true);
  });

  it('ONE_SQUARE wins with one 2x2', () => {
    expect(evaluate('ONE_SQUARE', square(0, 0)).isWinner).toBe(true);
  });

  it('TWO_SQUARES wins with two separate squares', () => {
    expect(
      evaluate('TWO_SQUARES', [...square(0, 0), ...square(3, 3)]).isWinner,
    ).toBe(true);
  });

  it('TWO_SQUARES rejects overlapping squares', () => {
    expect(
      evaluate('TWO_SQUARES', [...square(0, 0), ...square(0, 1)]).isWinner,
    ).toBe(false);
  });

  it('ONE_ROW_ONE_COLUMN wins', () => {
    expect(
      evaluate('ONE_ROW_ONE_COLUMN', [...row(0), ...col(0)]).isWinner,
    ).toBe(true);
  });

  it('ONE_RECTANGLE wins with a 2x3', () => {
    expect(evaluate('ONE_RECTANGLE', rectangle2x3(0, 0)).isWinner).toBe(true);
  });

  it('ONE_LINE_TOUCH_FREE wins with center row', () => {
    expect(evaluate('ONE_LINE_TOUCH_FREE', row(2)).isWinner).toBe(true);
  });

  it('ONE_LINE_TOUCH_FREE rejects a line without free', () => {
    expect(evaluate('ONE_LINE_TOUCH_FREE', row(0)).isWinner).toBe(false);
  });

  it('ONE_LINE_WITHOUT_FREE wins with top row', () => {
    expect(evaluate('ONE_LINE_WITHOUT_FREE', row(0)).isWinner).toBe(true);
  });

  it('ONE_LINE_WITHOUT_FREE rejects a free-touching line', () => {
    expect(evaluate('ONE_LINE_WITHOUT_FREE', row(2)).isWinner).toBe(false);
  });

  it('ONE_COLUMN wins', () => {
    expect(evaluate('ONE_COLUMN', col(0)).isWinner).toBe(true);
  });

  it('TWO_COLUMNS wins', () => {
    expect(evaluate('TWO_COLUMNS', [...col(0), ...col(4)]).isWinner).toBe(
      true,
    );
  });

  it('ONE_ROW wins', () => {
    expect(evaluate('ONE_ROW', row(4)).isWinner).toBe(true);
  });

  it('TWO_ROWS wins', () => {
    expect(evaluate('TWO_ROWS', [...row(0), ...row(4)]).isWinner).toBe(true);
  });
});
