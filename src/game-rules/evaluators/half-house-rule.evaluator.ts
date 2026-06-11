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

const HALF_HOUSE_TARGET_ROWS = 3;

export class HalfHouseRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'HALF_HOUSE';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const completedRowCount = completedRows.length;
    const isWinner = completedRowCount >= HALF_HOUSE_TARGET_ROWS;
    const progress = Math.min(completedRowCount / HALF_HOUSE_TARGET_ROWS, 1);
    const matchedRows = completedRows.map((rowNumber) => `ROW_${rowNumber}`);
    const matchedPattern =
      matchedRows.length > 0
        ? `HALF_HOUSE:${matchedRows.join(',')}`
        : 'HALF_HOUSE:NONE';

    return {
      isWinner,
      matchedPattern,
      progress,
    };
  }
}
