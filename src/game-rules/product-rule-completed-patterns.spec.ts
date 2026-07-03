import { CalledNumberRecord } from '../called-numbers/called-numbers.select';
import { GameRuleEvaluationService } from './game-rule-evaluation.service';
import { EvaluatorCartela } from './interfaces/game-rule-evaluator.interface';
import { ComboPattern } from './combo/combo.types';
import {
  PRODUCT_RULE_KEYS,
  getRulePattern,
} from './patterns/game-rule.patterns';
import { GameRulePattern } from './patterns/pattern.types';

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
    id: `called-${number}-${index}`,
    gameSessionId: 'session-1',
    letter: 'B',
    number,
    order: index + 1,
    createdAt: new Date('2026-06-08T10:00:00.000Z'),
  }));
}

function expectedWinnerPatternCount(pattern: GameRulePattern): number {
  if (pattern.type === 'FULL_HOUSE') {
    return 5;
  }

  if (pattern.type === 'COMBO') {
    return (pattern as ComboPattern).requires.reduce(
      (sum, requirement) => sum + requirement.count,
      0,
    );
  }

  return 1;
}

describe('product rule completed pattern display', () => {
  const service = new GameRuleEvaluationService();
  const cartela = createCartela();

  const row1 = [7, 22, 37, 56, 74];
  const row2 = [13, 20, 43, 51, 64];
  const row3 = [10, 26, 57, 65];
  const row4 = [9, 18, 41, 60, 72];
  const row5 = [4, 21, 42, 53, 62];
  const colB = [7, 13, 10, 9, 4];
  const colI = [22, 20, 26, 18, 21];
  const colN = [37, 43, 41, 42];
  const diag1 = [7, 20, 60, 62];
  const diag2 = [74, 18, 42, 51, 4];

  it.each([...PRODUCT_RULE_KEYS])('%s has a seeded pattern definition', (ruleKey) => {
    expect(getRulePattern(ruleKey)).not.toBeNull();
  });

  it.each([...PRODUCT_RULE_KEYS])(
    '%s pattern type is FULL_HOUSE or COMBO',
    (ruleKey) => {
      const pattern = getRulePattern(ruleKey)!;
      expect(['FULL_HOUSE', 'COMBO']).toContain(pattern.type);
    },
  );

  const lineRulesWithExtraCompletedLines: Array<{
    ruleKey: (typeof PRODUCT_RULE_KEYS)[number];
    numbers: number[];
  }> = [
    { ruleKey: 'THREE_LINES', numbers: [...row1, ...row2, ...row4, ...row5] },
    { ruleKey: 'FOUR_LINES', numbers: [...row1, ...row2, ...row3, ...row4, ...row5] },
    { ruleKey: 'MIX_05', numbers: [...row1, ...row2, ...row3, ...row4, ...row5, ...colB] },
    { ruleKey: 'MIX_06', numbers: [...row1, ...row2, ...row4, ...colB] },
    { ruleKey: 'MIX_10', numbers: [...row1, ...row2, ...row3, ...row4, ...row5, ...colB, ...colI] },
    { ruleKey: 'MIX_12', numbers: [...row3, ...colN, ...diag1, ...diag2] },
    { ruleKey: 'THREE_ROWS', numbers: [...row1, ...row2, ...row3, ...row4] },
    { ruleKey: 'THREE_COLUMNS', numbers: [...colB, ...colI, ...colN, ...row1] },
    { ruleKey: 'SIX_LINES', numbers: [...row1, ...row2, ...row3, ...row4, ...row5, ...colB] },
    { ruleKey: 'TWO_DIAGONALS', numbers: [...diag1, ...diag2, ...row1] },
  ];

  it.each(lineRulesWithExtraCompletedLines)(
    '$ruleKey returns only the winning pattern count when extra lines are complete',
    ({ ruleKey, numbers }) => {
      const pattern = getRulePattern(ruleKey)!;
      const expectedCount = expectedWinnerPatternCount(pattern);
      const result = service.evaluate(cartela, called(numbers), ruleKey, pattern);

      expect(result.isWinner).toBe(true);
      expect(result.completedPatterns).toHaveLength(expectedCount);
    },
  );

  it('FULL_HOUSE shows all five rows', () => {
    const pattern = getRulePattern('FULL_HOUSE')!;
    const result = service.evaluate(
      cartela,
      called([
        7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60,
        53, 74, 64, 65, 72, 62,
      ]),
      'FULL_HOUSE',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns).toHaveLength(5);
    expect(result.completedPatterns.every((entry) => entry.type === 'ROW')).toBe(
      true,
    );
  });

  it('MIX_01 returns exactly five patterns when extra columns and rows exist', () => {
    const pattern = getRulePattern('MIX_01')!;
    const result = service.evaluate(
      cartela,
      called([...colB, ...colI, ...colN, ...row1, ...row2, ...row3, ...diag1]),
      'MIX_01',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns).toHaveLength(5);
  });

  it('MIX_14 returns exactly three patterns', () => {
    const pattern = getRulePattern('MIX_14')!;
    const result = service.evaluate(
      cartela,
      called([...row3, ...row1, ...row2, ...row4]),
      'MIX_14',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns).toHaveLength(3);
  });
});
