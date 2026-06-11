import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  buildCalledNumbersSet,
  getCompletedColumnIndexes,
} from './board.util';

const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];

export class ColumnsRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'COLUMNS';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedColumns = getCompletedColumnIndexes(
      cartela,
      calledNumbersSet,
    );
    const isWinner = completedColumns.length > 0;
    const progress = isWinner ? 1 : completedColumns.length / 5;
    const matchedColumns = completedColumns.map(
      (index) => `COL_${COLUMN_LABELS[index]}`,
    );

    return {
      isWinner,
      matchedPattern: isWinner
        ? `COLUMNS:${matchedColumns.join(',')}`
        : 'COLUMNS:NONE',
      progress,
    };
  }
}
