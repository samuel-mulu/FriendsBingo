import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  buildCalledNumbersSet,
  getCompletedDiagonalIndexes,
} from './board.util';

export class DiagonalRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'DIAGONAL';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedDiagonals = getCompletedDiagonalIndexes(
      cartela,
      calledNumbersSet,
    );
    const isWinner = completedDiagonals.length > 0;
    const progress = isWinner ? 1 : 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `DIAGONAL:DIAG_${completedDiagonals.join(',DIAG_')}`
        : 'DIAGONAL:NONE',
      progress,
    };
  }
}
