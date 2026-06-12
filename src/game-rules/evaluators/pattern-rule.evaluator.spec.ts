import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { PatternRuleEvaluator } from './pattern-rule.evaluator';

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

describe('PatternRuleEvaluator', () => {
  const evaluator = new PatternRuleEvaluator();
  const cartela = createCartela();

  const activeRules = [
    'FULL_HOUSE',
    'HALF_HOUSE',
    'LINE',
    'FOUR_CORNERS',
    'ROWS',
    'COLUMNS',
    'DIAGONAL',
  ] as const;

  it.each(activeRules)('has a seeded pattern for %s', (ruleKey) => {
    expect(getRulePattern(ruleKey)).not.toBeNull();
  });

  it('FULL_HOUSE wins only when every row is complete and FREE is auto-marked', () => {
    const pattern = getRulePattern('FULL_HOUSE')!;
    const partial = called([7, 13, 10, 9, 4]);
    const full = called([
      7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53,
      74, 64, 65, 72, 62,
    ]);

    expect(
      evaluator.evaluate(cartela, partial, 'FULL_HOUSE', pattern).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, full, 'FULL_HOUSE', pattern).isWinner,
    ).toBe(true);
  });

  it('HALF_HOUSE requires three complete rows', () => {
    const pattern = getRulePattern('HALF_HOUSE')!;
    const twoRows = called([7, 22, 37, 56, 74, 13, 20, 43, 51, 64]);
    const threeRows = called([
      7, 22, 37, 56, 74, 13, 20, 43, 51, 64, 10, 26, 41, 57, 65,
    ]);

    expect(
      evaluator.evaluate(cartela, twoRows, 'HALF_HOUSE', pattern).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, threeRows, 'HALF_HOUSE', pattern).isWinner,
    ).toBe(true);
  });

  it('marks ROWS as latest-draw winners only when the newest call completes the row', () => {
    const pattern = getRulePattern('ROWS')!;
    const onTime = evaluator.evaluate(
      cartela,
      called([7, 22, 37, 56, 74]),
      'ROWS',
      pattern,
    );
    const late = evaluator.evaluate(
      cartela,
      called([7, 22, 37, 56, 74, 75]),
      'ROWS',
      pattern,
    );

    expect(onTime.latestCalledNumber).toBe(74);
    expect(onTime.completedByLatestNumber).toBe(true);
    expect(late.isWinner).toBe(true);
    expect(late.latestCalledNumber).toBe(75);
    expect(late.completedByLatestNumber).toBe(false);
  });

  it('tracks latest-draw completion for COLUMNS, DIAGONAL, and FOUR_CORNERS', () => {
    const column = evaluator.evaluate(
      cartela,
      called([7, 13, 10, 9, 4]),
      'COLUMNS',
      getRulePattern('COLUMNS')!,
    );
    const diagonal = evaluator.evaluate(
      cartela,
      called([7, 20, 41, 60, 62]),
      'DIAGONAL',
      getRulePattern('DIAGONAL')!,
    );
    const fourCorners = evaluator.evaluate(
      cartela,
      called([7, 74, 4, 62]),
      'FOUR_CORNERS',
      getRulePattern('FOUR_CORNERS')!,
    );

    expect(column.completedByLatestNumber).toBe(true);
    expect(column.completedPatterns).toEqual([
      expect.objectContaining({
        key: 'COL_B',
      }),
    ]);
    expect(diagonal.completedByLatestNumber).toBe(true);
    expect(diagonal.completedPatterns).toEqual([
      expect.objectContaining({
        key: 'DIAG_1',
      }),
    ]);
    expect(fourCorners.completedByLatestNumber).toBe(true);
    expect(fourCorners.completedPatterns).toEqual([
      expect.objectContaining({
        key: 'PATTERN_1',
      }),
    ]);
  });

  it('rejects late FULL_HOUSE and HALF_HOUSE claims when the threshold was already met earlier', () => {
    const fullHouse = evaluator.evaluate(
      cartela,
      called([
        7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53,
        74, 64, 65, 72, 62, 75,
      ]),
      'FULL_HOUSE',
      getRulePattern('FULL_HOUSE')!,
    );
    const halfHouse = evaluator.evaluate(
      cartela,
      called([7, 22, 37, 56, 74, 13, 20, 43, 51, 64, 10, 26, 41, 57, 65, 72]),
      'HALF_HOUSE',
      getRulePattern('HALF_HOUSE')!,
    );

    expect(fullHouse.isWinner).toBe(true);
    expect(fullHouse.completedByLatestNumber).toBe(false);
    expect(halfHouse.isWinner).toBe(true);
    expect(halfHouse.completedByLatestNumber).toBe(false);
  });

  it('LINE wins with any complete row, column, or diagonal', () => {
    const pattern = getRulePattern('LINE')!;

    expect(
      evaluator.evaluate(cartela, called([7, 22, 37, 56, 74]), 'LINE', pattern)
        .isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7, 13, 10, 9, 4]), 'LINE', pattern)
        .isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7, 20, 41, 60, 62]), 'LINE', pattern)
        .isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(cartela, called([7]), 'LINE', pattern).isWinner,
    ).toBe(false);
  });

  it('ROWS, COLUMNS, and DIAGONAL reject partial boards', () => {
    expect(
      evaluator.evaluate(cartela, called([7]), 'ROWS', getRulePattern('ROWS')!)
        .isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        cartela,
        called([7]),
        'COLUMNS',
        getRulePattern('COLUMNS')!,
      ).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        cartela,
        called([7]),
        'DIAGONAL',
        getRulePattern('DIAGONAL')!,
      ).isWinner,
    ).toBe(false);
  });

  it('LINE_TOUCHES_FREE requires a line through the center', () => {
    const pattern = getRulePattern('LINE_TOUCHES_FREE')!;

    expect(
      evaluator.evaluate(
        cartela,
        called([7, 22, 37, 56, 74]),
        'LINE_TOUCHES_FREE',
        pattern,
      ).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        cartela,
        called([7, 20, 41, 60, 62]),
        'LINE_TOUCHES_FREE',
        pattern,
      ).isWinner,
    ).toBe(true);
  });

  it('LINES_WITHOUT_FREE rejects lines that pass through FREE', () => {
    const pattern = getRulePattern('LINES_WITHOUT_FREE')!;

    expect(
      evaluator.evaluate(
        cartela,
        called([7, 20, 41, 60, 62]),
        'LINES_WITHOUT_FREE',
        pattern,
      ).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        cartela,
        called([7, 13, 10, 9, 4]),
        'LINES_WITHOUT_FREE',
        pattern,
      ).isWinner,
    ).toBe(true);
  });

  it('BIG_T shape wins only when all required cells are called', () => {
    const pattern = getRulePattern('BIG_T')!;
    const partial = called([7, 13, 10, 9, 4]);
    const complete = called([7, 22, 37, 56, 74, 43, 41, 42]);

    expect(
      evaluator.evaluate(cartela, partial, 'BIG_T', pattern).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, complete, 'BIG_T', pattern).isWinner,
    ).toBe(true);
  });
});
