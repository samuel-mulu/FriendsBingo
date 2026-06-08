import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
} from '../interfaces/game-rule-evaluator.interface';
import { BoardCoord, GameRulePattern } from '../patterns/pattern.types';
import {
  buildBoardRows,
  buildCalledNumbersSet,
  getCompletedColumnIndexes,
  getCompletedDiagonalIndexes,
  getCompletedRowIndexes,
  isFullHouse,
  isMarkedCellValue,
} from './board.util';

const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];
const FREE_CENTER: BoardCoord = [2, 2];

export class PatternRuleEvaluator {
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    ruleKey: string,
    pattern: GameRulePattern,
  ): GameRuleEvaluationResult {
    const normalizedRuleKey = ruleKey.trim().toUpperCase();
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);

    switch (pattern.type) {
      case 'FULL_HOUSE':
        return this.evaluateFullHouse(cartela, calledNumbersSet, normalizedRuleKey);
      case 'ROWS_REQUIRED':
        return this.evaluateRowsRequired(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
          pattern.count,
        );
      case 'ANY_LINE':
        return this.evaluateAnyLine(cartela, calledNumbersSet, normalizedRuleKey);
      case 'ANY_ROW':
        return this.evaluateAnyRow(cartela, calledNumbersSet, normalizedRuleKey);
      case 'ANY_COLUMN':
        return this.evaluateAnyColumn(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
        );
      case 'ANY_DIAGONAL':
        return this.evaluateAnyDiagonal(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
        );
      case 'LINE_TOUCHES_FREE':
        return this.evaluateLineTouchesFree(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
        );
      case 'LINE_WITHOUT_FREE':
        return this.evaluateLineWithoutFree(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
        );
      case 'PATTERN_GROUP':
        return this.evaluatePatternGroup(
          cartela,
          calledNumbersSet,
          normalizedRuleKey,
          pattern.patterns,
        );
      default:
        return {
          isWinner: false,
          matchedPattern: `${normalizedRuleKey}:UNSUPPORTED_PATTERN`,
          progress: 0,
        };
    }
  }

  private evaluateFullHouse(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const isWinner = isFullHouse(cartela, calledNumbersSet);

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:ALL_ROWS`
        : `${ruleKey}:ROWS_${completedRows.join(',') || 'NONE'}`,
      progress: completedRows.length / 5,
    };
  }

  private evaluateRowsRequired(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
    count: number,
  ): GameRuleEvaluationResult {
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const completedRowCount = completedRows.length;
    const isWinner = completedRowCount >= count;
    const matchedRows = completedRows.map((rowNumber) => `ROW_${rowNumber}`);

    return {
      isWinner,
      matchedPattern:
        matchedRows.length > 0
          ? `${ruleKey}:${matchedRows.join(',')}`
          : `${ruleKey}:NONE`,
      progress: Math.min(completedRowCount / count, 1),
    };
  }

  private evaluateAnyLine(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
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

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:${matchedLines.join(',')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : 0,
    };
  }

  private evaluateAnyRow(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const isWinner = completedRows.length > 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:ROW_${completedRows.join(',ROW_')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : completedRows.length / 5,
    };
  }

  private evaluateAnyColumn(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedColumns = getCompletedColumnIndexes(
      cartela,
      calledNumbersSet,
    );
    const isWinner = completedColumns.length > 0;
    const matchedColumns = completedColumns.map(
      (index) => `COL_${COLUMN_LABELS[index]}`,
    );

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:${matchedColumns.join(',')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : completedColumns.length / 5,
    };
  }

  private evaluateAnyDiagonal(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedDiagonals = getCompletedDiagonalIndexes(
      cartela,
      calledNumbersSet,
    );
    const isWinner = completedDiagonals.length > 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:DIAG_${completedDiagonals.join(',DIAG_')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : 0,
    };
  }

  private evaluateLineTouchesFree(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
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
    if (completedRows.includes(FREE_CENTER[0] + 1)) {
      matchedLines.push(`ROW_${FREE_CENTER[0] + 1}`);
    }
    if (completedColumns.includes(FREE_CENTER[1])) {
      matchedLines.push(`COL_${COLUMN_LABELS[FREE_CENTER[1]]}`);
    }
    if (completedDiagonals.length > 0) {
      matchedLines.push(`DIAG_${completedDiagonals[0]}`);
    }

    const isWinner = matchedLines.length > 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:${matchedLines.join(',')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : 0,
    };
  }

  private evaluateLineWithoutFree(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet).filter(
      (rowNumber) => rowNumber !== FREE_CENTER[0] + 1,
    );
    const completedColumns = getCompletedColumnIndexes(
      cartela,
      calledNumbersSet,
    ).filter((columnIndex) => columnIndex !== FREE_CENTER[1]);
    const matchedLines: string[] = [];

    if (completedRows.length > 0) {
      matchedLines.push(`ROW_${completedRows[0]}`);
    }
    if (completedColumns.length > 0) {
      matchedLines.push(`COL_${COLUMN_LABELS[completedColumns[0]]}`);
    }

    const isWinner = matchedLines.length > 0;

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:${matchedLines.join(',')}`
        : `${ruleKey}:NONE`,
      progress: isWinner ? 1 : 0,
    };
  }

  private evaluatePatternGroup(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    ruleKey: string,
    patternGroups: BoardCoord[][],
  ): GameRuleEvaluationResult {
    const boardRows = buildBoardRows(cartela);
    let bestProgress = 0;
    let matchedPattern: string | null = null;

    patternGroups.forEach((group, index) => {
      const markedCount = group.filter(([row, col]) =>
        isMarkedCellValue(boardRows[row]?.[col], calledNumbersSet),
      ).length;
      const progress = group.length > 0 ? markedCount / group.length : 0;
      const isComplete = markedCount === group.length;

      if (progress > bestProgress) {
        bestProgress = progress;
      }

      if (isComplete && !matchedPattern) {
        matchedPattern = `${ruleKey}:PATTERN_${index + 1}`;
      }
    });

    return {
      isWinner: matchedPattern !== null,
      matchedPattern: matchedPattern ?? `${ruleKey}:NONE`,
      progress: Math.min(bestProgress, 1),
    };
  }
}
