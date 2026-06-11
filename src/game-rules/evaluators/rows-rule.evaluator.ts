import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  buildCalledNumbersSet,
  getCompletedRowIndexes,
} from './board.util';

export class RowsRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'ROWS';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const isWinner = completedRows.length > 0;
    const progress = isWinner ? 1 : completedRows.length / 5;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `ROWS:ROW_${completedRows.join(',ROW_')}`
        : 'ROWS:NONE',
      progress,
    };
  }
}
