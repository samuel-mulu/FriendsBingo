import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { PatternRuleEvaluator } from './pattern-rule.evaluator';

export class DiagonalRuleEvaluator implements GameRuleEvaluator {
  private readonly evaluator = new PatternRuleEvaluator();

  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'DIAGONAL';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    gameType: string,
  ): GameRuleEvaluationResult {
    return this.evaluator.evaluate(
      cartela,
      calledNumbers,
      gameType,
      getRulePattern('DIAGONAL')!,
    );
  }
}
