import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  buildCalledNumbersSet,
  getCompletedRowIndexes,
  isFullHouse,
} from './board.util';

export class FullHouseRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'FULL_HOUSE';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const isWinner = isFullHouse(cartela, calledNumbersSet);
    const progress = completedRows.length / 5;
    const matchedPattern = isWinner
      ? 'FULL_HOUSE:ALL_ROWS'
      : `FULL_HOUSE:ROWS_${completedRows.join(',') || 'NONE'}`;

    return {
      isWinner,
      matchedPattern,
      progress,
    };
  }
}
