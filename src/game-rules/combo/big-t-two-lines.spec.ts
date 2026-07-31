import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { parseGameRulePattern } from '../patterns/game-rule.patterns';
import { BIG_T_VARIANTS } from '../combo/base-pattern-generator';
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

describe('BIG_T_TWO_LINES', () => {
  const evaluator = new PatternRuleEvaluator();
  const pattern = getRulePattern('BIG_T_TWO_LINES');
  const cartela = buildCartela();
  const bigT = BIG_T_VARIANTS[0];

  it('parses the seed JSON constraint so a stored rule keeps the new semantics', () => {
    const parsed = parseGameRulePattern({
      type: 'COMBO',
      overlap: 'MIXED',
      requires: [
        { kind: 'BIG_T', count: 1, group: 'BIG_T' },
        {
          kind: 'LINE',
          count: 2,
          group: 'LINES',
          mustNotBeContainedInGroups: ['BIG_T'],
        },
      ],
    });

    expect(parsed).toEqual({
      type: 'COMBO',
      overlap: 'MIXED',
      requires: [
        { kind: 'BIG_T', count: 1, group: 'BIG_T' },
        {
          kind: 'LINE',
          count: 2,
          group: 'LINES',
          mustNotBeContainedInGroups: ['BIG_T'],
        },
      ],
    });
  });

  it('does not treat a bare big T as a win', () => {
    const result = evaluator.evaluate(
      cartela,
      calledNumbersForCells(bigT),
      'BIG_T_TWO_LINES',
      pattern!,
    );

    expect(result.isWinner).toBe(false);
  });

  it('wins when the T is joined by two independent lines', () => {
    const row2: Array<[number, number]> = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ];
    const row4: Array<[number, number]> = [
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [4, 4],
    ];

    const result = evaluator.evaluate(
      cartela,
      calledNumbersForCells([...bigT, ...row2, ...row4]),
      'BIG_T_TWO_LINES',
      pattern!,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns).toHaveLength(3);
    expect(result.completedPatterns.some((entry) => entry.type === 'BIG_T')).toBe(
      true,
    );
    expect(
      result.completedPatterns.filter((entry) => entry.type === 'LINE'),
    ).toHaveLength(2);
  });

  it('allows lines that cross the T', () => {
    const row2: Array<[number, number]> = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ];
    const antiDiag: Array<[number, number]> = [
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 1],
      [4, 0],
    ];

    const result = evaluator.evaluate(
      cartela,
      calledNumbersForCells([...bigT, ...row2, ...antiDiag]),
      'BIG_T_TWO_LINES',
      pattern!,
    );

    expect(result.isWinner).toBe(true);
  });
});
