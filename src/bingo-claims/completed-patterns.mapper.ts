import {
  buildBoardRows,
  getCellNumber,
} from '../game-rules/evaluators/board.util';
import {
  CompletedPattern,
  EvaluatorCartela,
} from '../game-rules/interfaces/game-rule-evaluator.interface';
import { BoardCoord } from '../game-rules/patterns/pattern.types';

export type SerializedCompletedPattern = {
  type: string;
  key?: string;
  numbers: number[];
  cells: [number, number][];
};

export function serializeCompletedPatterns(
  patterns: CompletedPattern[],
  cartela: EvaluatorCartela,
): SerializedCompletedPattern[] {
  const boardRows = buildBoardRows(cartela);

  return patterns.map((pattern) => {
    let cells = pattern.cells ?? [];
    if (cells.length === 0 && pattern.numbers.length > 0) {
      cells = deriveCellsFromNumbers(boardRows, pattern.numbers);
    }

    return {
      type: pattern.type,
      ...(pattern.key ? { key: pattern.key } : {}),
      numbers: pattern.numbers,
      cells: cells.map(([row, col]) => [row, col] as [number, number]),
    };
  });
}

function deriveCellsFromNumbers(
  boardRows: unknown[][],
  numbers: number[],
): BoardCoord[] {
  const numberSet = new Set(numbers);
  const cells: BoardCoord[] = [];

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const num = getCellNumber(boardRows[row]?.[col]);
      if (num !== null && numberSet.has(num)) {
        cells.push([row, col]);
      }
    }
  }

  return cells;
}
