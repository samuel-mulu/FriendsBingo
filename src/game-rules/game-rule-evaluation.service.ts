import { Injectable } from '@nestjs/common';
import { CalledNumberRecord } from '../called-numbers/called-numbers.select';
import { ColumnsRuleEvaluator } from './evaluators/columns-rule.evaluator';
import { DiagonalRuleEvaluator } from './evaluators/diagonal-rule.evaluator';
import { FullHouseRuleEvaluator } from './evaluators/full-house-rule.evaluator';
import { HalfHouseRuleEvaluator } from './evaluators/half-house-rule.evaluator';
import { LineRuleEvaluator } from './evaluators/line-rule.evaluator';
import { PatternRuleEvaluator } from './evaluators/pattern-rule.evaluator';
import { RowsRuleEvaluator } from './evaluators/rows-rule.evaluator';
import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from './interfaces/game-rule-evaluator.interface';
import {
  getRulePattern,
  parseGameRulePattern,
} from './patterns/game-rule.patterns';

@Injectable()
export class GameRuleEvaluationService {
  private readonly legacyEvaluators: GameRuleEvaluator[];
  private readonly patternRuleEvaluator = new PatternRuleEvaluator();

  constructor() {
    this.legacyEvaluators = [
      new FullHouseRuleEvaluator(),
      new HalfHouseRuleEvaluator(),
      new LineRuleEvaluator(),
      new RowsRuleEvaluator(),
      new ColumnsRuleEvaluator(),
      new DiagonalRuleEvaluator(),
    ];
  }

  isManualRule(ruleKey: string | null | undefined): boolean {
    return (ruleKey ?? 'MANUAL').trim().toUpperCase() === 'MANUAL';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    ruleKey: string,
    patterns?: unknown,
  ): GameRuleEvaluationResult {
    const normalizedRuleKey = ruleKey.trim().toUpperCase();
    const resolvedPattern =
      parseGameRulePattern(patterns) ?? getRulePattern(normalizedRuleKey);

    if (resolvedPattern) {
      return this.patternRuleEvaluator.evaluate(
        cartela,
        calledNumbers,
        normalizedRuleKey,
        resolvedPattern,
      );
    }

    const legacyEvaluator = this.legacyEvaluators.find((entry) =>
      entry.supports(normalizedRuleKey),
    );

    if (!legacyEvaluator) {
      return {
        isWinner: false,
        matchedPattern: `${normalizedRuleKey}:UNSUPPORTED`,
        progress: 0,
      };
    }

    return legacyEvaluator.evaluate(
      cartela,
      calledNumbers,
      normalizedRuleKey,
    );
  }
}
