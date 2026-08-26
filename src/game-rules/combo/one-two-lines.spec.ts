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

describe('ONE_LINE and TWO_LINES', () => {
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

  it('registers patterns for ONE_LINE and TWO_LINES', () => {
    expect(getRulePattern('ONE_LINE')).toEqual({
      type: 'COMBO',
      overlap: 'ALLOW',
      requires: [{ kind: 'LINE', count: 1 }],
    });
    expect(getRulePattern('TWO_LINES')).toEqual({
      type: 'COMBO',
      overlap: 'ALLOW',
      requires: [{ kind: 'LINE', count: 2 }],
    });
  });

  describe('ONE_LINE', () => {
    it('wins with a completed row', () => {
      const result = evaluate('ONE_LINE', row(0));
      expect(result.isWinner).toBe(true);
      expect(result.progress).toBe(1);
    });

    it('wins with a completed column', () => {
      const result = evaluate('ONE_LINE', col(1));
      expect(result.isWinner).toBe(true);
    });

    it('does not win with a partial line', () => {
      const result = evaluate(
        'ONE_LINE',
        row(0).slice(0, 4) as Array<[number, number]>,
      );
      expect(result.isWinner).toBe(false);
      expect(result.progress).toBeLessThan(1);
    });
  });

  describe('TWO_LINES', () => {
    it('wins with two overlapping lines', () => {
      const cells = [...row(0), ...col(0)];
      const result = evaluate('TWO_LINES', cells);
      expect(result.isWinner).toBe(true);
      expect(result.progress).toBe(1);
      expect(
        result.completedPatterns.filter((entry) => entry.type === 'LINE'),
      ).toHaveLength(2);
    });

    it('does not win with only one line', () => {
      const result = evaluate('TWO_LINES', row(2));
      expect(result.isWinner).toBe(false);
      expect(result.progress).toBeGreaterThan(0);
      expect(result.progress).toBeLessThan(1);
    });
  });
});
