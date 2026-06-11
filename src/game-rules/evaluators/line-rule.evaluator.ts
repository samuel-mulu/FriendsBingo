import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  buildCalledNumbersSet,
  getCompletedColumnIndexes,
  getCompletedDiagonalIndexes,
  getCompletedRowIndexes,
} from './board.util';

const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];

export class LineRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'LINE';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const completedColumns = getCompletedColumnIndexes(
      cartela,
      calledNumbersSet,
    );
    const completedDiagonals = getCompletedDiagonalIndexes(
      cartela,
      calledNumbersSet,
    );

    const matchedLines: string[] = [];
    if (completedRows.length > 0) {
      matchedLines.push(`ROW_${completedRows[0]}`);
    }
    if (completedColumns.length > 0) {
      matchedLines.push(`COL_${COLUMN_LABELS[completedColumns[0]]}`);
    }
    if (completedDiagonals.length > 0) {
      matchedLines.push(`DIAG_${completedDiagonals[0]}`);
    }

    const isWinner = matchedLines.length > 0;
    const progress = isWinner ? 1 : 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `LINE:${matchedLines.join(',')}`
        : 'LINE:NONE',
      progress,
    };
  }
}
