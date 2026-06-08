import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';

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
