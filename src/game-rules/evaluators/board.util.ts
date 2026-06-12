import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { BoardCoord } from '../patterns/pattern.types';

export function buildBoardRows(cartela: EvaluatorCartela): unknown[][] {
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

export function buildBoardColumns(cartela: EvaluatorCartela): unknown[][] {
  return [
    normalizeColumn(cartela.b),
    normalizeColumn(cartela.i),
    normalizeColumn(cartela.n),
    normalizeColumn(cartela.g),
    normalizeColumn(cartela.o),
  ];
}

export function buildRowCells(rowIndex: number): BoardCoord[] {
  return Array.from({ length: 5 }, (_, columnIndex) => [rowIndex, columnIndex]);
}

export function buildColumnCells(columnIndex: number): BoardCoord[] {
  return Array.from({ length: 5 }, (_, rowIndex) => [rowIndex, columnIndex]);
}

export function buildDiagonalCells(diagonalIndex: number): BoardCoord[] {
  if (diagonalIndex === 0) {
    return Array.from({ length: 5 }, (_, index) => [index, index]);
  }

  return Array.from({ length: 5 }, (_, index) => [index, 4 - index]);
}

export function getBoardDiagonals(cartela: EvaluatorCartela): unknown[][] {
  const rows = buildBoardRows(cartela);

  return [
    [rows[0][0], rows[1][1], rows[2][2], rows[3][3], rows[4][4]],
    [rows[0][4], rows[1][3], rows[2][2], rows[3][1], rows[4][0]],
  ];
}

function normalizeColumn(column: unknown): unknown[] {
  if (!Array.isArray(column)) {
    return [];
  }

  return column;
}

export function isMarkedCellValue(
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

export function buildCalledNumbersSet(
  calledNumbers: Array<{ number: number }>,
): Set<number> {
  return new Set(calledNumbers.map((entry) => entry.number));
}

export function withoutLatestCalledNumber<T extends { number: number }>(
  calledNumbers: T[],
): T[] {
  if (calledNumbers.length <= 1) {
    return [];
  }

  return calledNumbers.slice(0, -1);
}

export function getLatestCalledNumber(
  calledNumbers: Array<{ number: number }>,
): number | null {
  return calledNumbers.length > 0
    ? (calledNumbers[calledNumbers.length - 1]?.number ?? null)
    : null;
}

export function getCellNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim().toUpperCase();
    if (trimmedValue === 'FREE' || trimmedValue === '') {
      return null;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

export function getPatternNumbers(
  boardRows: unknown[][],
  cells: BoardCoord[],
): number[] {
  return cells
    .map(([row, col]) => getCellNumber(boardRows[row]?.[col]))
    .filter((value): value is number => value !== null);
}

export function getCompletedRowIndexes(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): number[] {
  const boardRows = buildBoardRows(cartela);
  const completedRows: number[] = [];

  boardRows.forEach((row, index) => {
    const rowCompleted = row.every((value) =>
      isMarkedCellValue(value, calledNumbersSet),
    );

    if (rowCompleted) {
      completedRows.push(index + 1);
    }
  });

  return completedRows;
}

export function getCompletedColumnIndexes(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): number[] {
  const boardColumns = buildBoardColumns(cartela);
  const completedColumns: number[] = [];
  const columnLabels = ['B', 'I', 'N', 'G', 'O'];

  boardColumns.forEach((column, index) => {
    const columnCompleted = column.every((value) =>
      isMarkedCellValue(value, calledNumbersSet),
    );

    if (columnCompleted) {
      completedColumns.push(index);
      void columnLabels[index];
    }
  });

  return completedColumns;
}

export function getCompletedDiagonalIndexes(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): number[] {
  const diagonals = getBoardDiagonals(cartela);
  const completedDiagonals: number[] = [];

  diagonals.forEach((diagonal, index) => {
    const diagonalCompleted = diagonal.every((value) =>
      isMarkedCellValue(value, calledNumbersSet),
    );

    if (diagonalCompleted) {
      completedDiagonals.push(index + 1);
    }
  });

  return completedDiagonals;
}

export function isFullHouse(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): boolean {
  return getCompletedRowIndexes(cartela, calledNumbersSet).length === 5;
}
