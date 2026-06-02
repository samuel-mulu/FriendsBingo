import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from '../interfaces/game-rule-evaluator.interface';
import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';

const HALF_HOUSE_TARGET_ROWS = 3;

export class HalfHouseRuleEvaluator implements GameRuleEvaluator {
  supports(gameType: string): boolean {
    return gameType.toUpperCase() === 'HALF_HOUSE';
  }

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    _gameType: string,
  ): GameRuleEvaluationResult {
    const boardRows = buildBoardRows(cartela);
    const calledNumbersSet = new Set(calledNumbers.map((entry) => entry.number));
    const completedRows: number[] = [];

    boardRows.forEach((row, index) => {
      const rowCompleted = row.every((value) =>
        isMarkedCellValue(value, calledNumbersSet),
      );

      if (rowCompleted) {
        completedRows.push(index + 1);
      }
    });

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

function buildBoardRows(cartela: EvaluatorCartela): unknown[][] {
  const columns = [
    normalizeColumn(cartela.b),
    normalizeColumn(cartela.i),
    normalizeColumn(cartela.n),
    normalizeColumn(cartela.g),
    normalizeColumn(cartela.o),
  ];

  return Array.from({ length: 5 }, (_, rowIndex) =>
    columns.map((column) => column[rowIndex] ?? null),
  );
}

function normalizeColumn(column: unknown): unknown[] {
  if (!Array.isArray(column)) {
    return [];
  }

  return column;
}

function isMarkedCellValue(
  value: unknown,
  calledNumbersSet: Set<number>,
): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim().toUpperCase();
    if (trimmedValue === 'FREE' || trimmedValue === '') {
      return true;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) && calledNumbersSet.has(numericValue);
  }

  if (typeof value === 'number') {
    return calledNumbersSet.has(value);
  }

  return false;
}
