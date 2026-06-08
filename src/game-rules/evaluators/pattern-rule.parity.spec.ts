import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { ColumnsRuleEvaluator } from './columns-rule.evaluator';
import { DiagonalRuleEvaluator } from './diagonal-rule.evaluator';
import { FullHouseRuleEvaluator } from './full-house-rule.evaluator';
import { HalfHouseRuleEvaluator } from './half-house-rule.evaluator';
import { LineRuleEvaluator } from './line-rule.evaluator';
import { PatternRuleEvaluator } from './pattern-rule.evaluator';
import { RowsRuleEvaluator } from './rows-rule.evaluator';
import { getRulePattern } from '../patterns/game-rule.patterns';

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

describe('PatternRuleEvaluator parity with legacy evaluators', () => {
  const cartela = createCartela();
  const patternEvaluator = new PatternRuleEvaluator();

  const cases = [
    {
      ruleKey: 'FULL_HOUSE',
      legacy: new FullHouseRuleEvaluator(),
      calledNumbers: called([
        7, 13, 10, 9, 4, 22, 20, 26, 18, 21, 37, 43, 41, 42, 56, 51, 57, 60, 53,
        74, 64, 65, 72, 62,
      ]),
    },
    {
      ruleKey: 'HALF_HOUSE',
      legacy: new HalfHouseRuleEvaluator(),
      calledNumbers: called([
        7, 22, 37, 56, 74, 13, 20, 43, 51, 64, 10, 26, 41, 57, 65,
      ]),
    },
    {
      ruleKey: 'LINE',
      legacy: new LineRuleEvaluator(),
      calledNumbers: called([7, 22, 37, 56, 74]),
    },
    {
      ruleKey: 'ROWS',
      legacy: new RowsRuleEvaluator(),
      calledNumbers: called([7, 22, 37, 56, 74]),
    },
    {
      ruleKey: 'COLUMNS',
      legacy: new ColumnsRuleEvaluator(),
      calledNumbers: called([7, 13, 10, 9, 4]),
    },
    {
      ruleKey: 'DIAGONAL',
      legacy: new DiagonalRuleEvaluator(),
      calledNumbers: called([7, 20, 41, 60, 62]),
    },
  ] as const;

  it.each(cases)(
    '$ruleKey generic engine matches legacy winner result',
    ({ ruleKey, legacy, calledNumbers }) => {
      const pattern = getRulePattern(ruleKey)!;
      const legacyResult = legacy.evaluate(cartela, calledNumbers, ruleKey);
      const patternResult = patternEvaluator.evaluate(
        cartela,
        calledNumbers,
        ruleKey,
        pattern,
      );

      expect(patternResult.isWinner).toBe(legacyResult.isWinner);
    },
  );
});
