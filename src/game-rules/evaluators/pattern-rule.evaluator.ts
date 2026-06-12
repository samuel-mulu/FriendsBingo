import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  CompletedPattern,
  EvaluatorCartela,
  GameRuleEvaluationResult,
} from '../interfaces/game-rule-evaluator.interface';
import { BoardCoord, GameRulePattern } from '../patterns/pattern.types';
import {
  buildBoardRows,
  buildCalledNumbersSet,
  buildColumnCells,
  buildDiagonalCells,
  buildRowCells,
  getCompletedColumnIndexes,
  getCompletedDiagonalIndexes,
  getCompletedRowIndexes,
  getLatestCalledNumber,
  getPatternNumbers,
  isFullHouse,
  isMarkedCellValue,
  withoutLatestCalledNumber,
} from './board.util';

const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];
const FREE_CENTER: BoardCoord = [2, 2];

export class PatternRuleEvaluator {
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    ruleKey: string,
    pattern: GameRulePattern,
  ): GameRuleEvaluationResult {
    const normalizedRuleKey = ruleKey.trim().toUpperCase();
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const latestCalledNumber = getLatestCalledNumber(calledNumbers);

    switch (pattern.type) {
      case 'FULL_HOUSE':
        return this.evaluateFullHouse(
          cartela,
          calledNumbers,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'ROWS_REQUIRED':
        return this.evaluateRowsRequired(
          cartela,
          calledNumbers,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
          pattern.count,
        );
      case 'ANY_LINE':
        return this.evaluateAnyLine(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'ANY_ROW':
        return this.evaluateAnyRow(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'ANY_COLUMN':
        return this.evaluateAnyColumn(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'ANY_DIAGONAL':
        return this.evaluateAnyDiagonal(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'LINE_TOUCHES_FREE':
        return this.evaluateLineTouchesFree(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'LINE_WITHOUT_FREE':
        return this.evaluateLineWithoutFree(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
        );
      case 'PATTERN_GROUP':
        return this.evaluatePatternGroup(
          cartela,
          calledNumbersSet,
          latestCalledNumber,
          normalizedRuleKey,
          pattern.patterns,
        );
      default:
        return this.createResult({
          isWinner: false,
          matchedPattern: `${normalizedRuleKey}:UNSUPPORTED_PATTERN`,
          progress: 0,
          latestCalledNumber,
          completedPatterns: [],
        });
    }
  }

  private evaluateFullHouse(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedRows = getCompletedRowIndexes(cartela, calledNumbersSet);
    const boardRows = buildBoardRows(cartela);
    const completedPatterns = completedRows.map((rowNumber) => ({
      type: 'ROW',
      key: `ROW_${rowNumber}`,
      cells: buildRowCells(rowNumber - 1),
      numbers: getPatternNumbers(boardRows, buildRowCells(rowNumber - 1)),
    }));
    const isWinner = isFullHouse(cartela, calledNumbersSet);
    const progress = completedRows.length / 5;
    const beforeLatestSet = buildCalledNumbersSet(
      withoutLatestCalledNumber(calledNumbers),
    );
    const wasWinnerBeforeLatest = isFullHouse(cartela, beforeLatestSet);
    const completedByLatestNumber =
      isWinner &&
      latestCalledNumber !== null &&
      !wasWinnerBeforeLatest &&
      completedPatterns.some((pattern) =>
        pattern.numbers.includes(latestCalledNumber),
      );

    return this.createResult({
      isWinner,
      matchedPattern: isWinner
        ? `${ruleKey}:ALL_ROWS`
        : `${ruleKey}:ROWS_${completedRows.join(',') || 'NONE'}`,
      progress,
      latestCalledNumber,
      completedPatterns,
      completedByLatestNumber,
    });
  }

  private evaluateRowsRequired(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
    count: number,
  ): GameRuleEvaluationResult {
    const completedPatterns = this.getCompletedRowPatterns(cartela, calledNumbersSet);
    const completedRowCount = completedPatterns.length;
    const isWinner = completedRowCount >= count;
    const beforeLatestSet = buildCalledNumbersSet(
      withoutLatestCalledNumber(calledNumbers),
    );
    const completedRowsBeforeLatest = getCompletedRowIndexes(
      cartela,
      beforeLatestSet,
    ).length;
    const completedByLatestNumber =
      isWinner &&
      latestCalledNumber !== null &&
      completedRowsBeforeLatest < count &&
      completedPatterns.some((pattern) =>
        pattern.numbers.includes(latestCalledNumber),
      );

    return this.createResult({
      isWinner,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: Math.min(completedRowCount / count, 1),
      latestCalledNumber,
      completedPatterns,
      completedByLatestNumber,
    });
  }

  private evaluateAnyLine(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns = [
      ...this.getCompletedRowPatterns(cartela, calledNumbersSet),
      ...this.getCompletedColumnPatterns(cartela, calledNumbersSet),
      ...this.getCompletedDiagonalPatterns(cartela, calledNumbersSet),
    ];

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: completedPatterns.length > 0 ? 1 : 0,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluateAnyRow(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns = this.getCompletedRowPatterns(cartela, calledNumbersSet);

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress:
        completedPatterns.length > 0 ? 1 : completedPatterns.length / 5,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluateAnyColumn(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns = this.getCompletedColumnPatterns(
      cartela,
      calledNumbersSet,
    );

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress:
        completedPatterns.length > 0 ? 1 : completedPatterns.length / 5,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluateAnyDiagonal(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns = this.getCompletedDiagonalPatterns(
      cartela,
      calledNumbersSet,
    );

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: completedPatterns.length > 0 ? 1 : 0,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluateLineTouchesFree(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns: CompletedPattern[] = [];
    const rowPatterns = this.getCompletedRowPatterns(cartela, calledNumbersSet).filter(
      (pattern) => pattern.key === `ROW_${FREE_CENTER[0] + 1}`,
    );
    const columnPatterns = this.getCompletedColumnPatterns(
      cartela,
      calledNumbersSet,
    ).filter((pattern) => pattern.key === `COL_${COLUMN_LABELS[FREE_CENTER[1]]}`);
    const diagonalPatterns = this.getCompletedDiagonalPatterns(
      cartela,
      calledNumbersSet,
    );

    completedPatterns.push(...rowPatterns, ...columnPatterns, ...diagonalPatterns);

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: completedPatterns.length > 0 ? 1 : 0,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluateLineWithoutFree(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
  ): GameRuleEvaluationResult {
    const completedPatterns = [
      ...this.getCompletedRowPatterns(cartela, calledNumbersSet).filter(
        (pattern) => pattern.key !== `ROW_${FREE_CENTER[0] + 1}`,
      ),
      ...this.getCompletedColumnPatterns(cartela, calledNumbersSet).filter(
        (pattern) => pattern.key !== `COL_${COLUMN_LABELS[FREE_CENTER[1]]}`,
      ),
    ];

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: completedPatterns.length > 0 ? 1 : 0,
      latestCalledNumber,
      completedPatterns,
    });
  }

  private evaluatePatternGroup(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
    latestCalledNumber: number | null,
    ruleKey: string,
    patternGroups: BoardCoord[][],
  ): GameRuleEvaluationResult {
    const boardRows = buildBoardRows(cartela);
    const completedPatterns: CompletedPattern[] = [];
    let bestProgress = 0;

    patternGroups.forEach((group, index) => {
      const markedCount = group.filter(([row, col]) =>
        isMarkedCellValue(boardRows[row]?.[col], calledNumbersSet),
      ).length;
      const progress = group.length > 0 ? markedCount / group.length : 0;
      const isComplete = group.length > 0 && markedCount === group.length;

      if (progress > bestProgress) {
        bestProgress = progress;
      }

      if (isComplete) {
        completedPatterns.push({
          type: ruleKey,
          key: `PATTERN_${index + 1}`,
          cells: group,
          numbers: getPatternNumbers(boardRows, group),
        });
      }
    });

    return this.createResult({
      isWinner: completedPatterns.length > 0,
      matchedPattern:
        completedPatterns.length > 0
          ? `${ruleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
          : `${ruleKey}:NONE`,
      progress: Math.min(bestProgress, 1),
      latestCalledNumber,
      completedPatterns,
    });
  }

  private getCompletedRowPatterns(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
  ): CompletedPattern[] {
    const boardRows = buildBoardRows(cartela);
    return getCompletedRowIndexes(cartela, calledNumbersSet).map((rowNumber) => {
      const cells = buildRowCells(rowNumber - 1);
      return {
        type: 'ROW',
        key: `ROW_${rowNumber}`,
        cells,
        numbers: getPatternNumbers(boardRows, cells),
      };
    });
  }

  private getCompletedColumnPatterns(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
  ): CompletedPattern[] {
    const boardRows = buildBoardRows(cartela);
    return getCompletedColumnIndexes(cartela, calledNumbersSet).map((columnIndex) => {
      const cells = buildColumnCells(columnIndex);
      return {
        type: 'COLUMN',
        key: `COL_${COLUMN_LABELS[columnIndex]}`,
        cells,
        numbers: getPatternNumbers(boardRows, cells),
      };
    });
  }

  private getCompletedDiagonalPatterns(
    cartela: EvaluatorCartela,
    calledNumbersSet: Set<number>,
  ): CompletedPattern[] {
    const boardRows = buildBoardRows(cartela);
    return getCompletedDiagonalIndexes(cartela, calledNumbersSet).map(
      (diagonalIndex) => {
        const cells = buildDiagonalCells(diagonalIndex - 1);
        return {
          type: 'DIAGONAL',
          key: `DIAG_${diagonalIndex}`,
          cells,
          numbers: getPatternNumbers(boardRows, cells),
        };
      },
    );
  }

  private createResult({
    isWinner,
    matchedPattern,
    progress,
    latestCalledNumber,
    completedPatterns,
    completedByLatestNumber,
  }: {
    isWinner: boolean;
    matchedPattern: string;
    progress: number;
    latestCalledNumber: number | null;
    completedPatterns: CompletedPattern[];
    completedByLatestNumber?: boolean;
  }): GameRuleEvaluationResult {
    return {
      isWinner,
      matchedPattern,
      progress,
      latestCalledNumber,
      completedPatterns,
      completedByLatestNumber:
        completedByLatestNumber ??
        (latestCalledNumber !== null &&
          completedPatterns.some((pattern) =>
            pattern.numbers.includes(latestCalledNumber),
          )),
    };
  }
}
