import { BoardCoord } from '../patterns/pattern.types';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import {
  buildBoardRows,
  buildColumnCells,
  buildDiagonalCells,
  buildRowCells,
  getCellNumber,
  getCompletedColumnIndexes,
  getCompletedDiagonalIndexes,
  getCompletedRowIndexes,
  getPatternNumbers,
  isMarkedCellValue,
} from '../evaluators/board.util';
import { DirectionGroup, PatternInstance, PatternKind } from './combo.types';
import {
  HALF_HOUSE_10_DIRECTION_CELLS,
  HALF_HOUSE_4_DIRECTION_CELLS,
} from './half-house-pattern-definitions';
import {
  CORNER_VARIANTS,
  RECTANGLE_2X3_OR_3X2_VARIANTS,
  SMALL_T_VARIANTS,
  TRIANGLE_4X4_VARIANTS,
  TRIANGLE_6_VARIANTS,
} from './extended-pattern-definitions';

export {
  BIG_M_OR_W_VARIANTS,
  BIG_N_OR_Z_VARIANTS,
} from './extended-pattern-definitions';

export const FREE_CENTER: BoardCoord = [2, 2];

const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];

export const BIG_L_VARIANTS: BoardCoord[][] = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
  ],
  [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [4, 3],
    [4, 2],
    [4, 1],
    [4, 0],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [0, 3],
    [0, 2],
    [0, 1],
    [0, 0],
  ],
];

export const BIG_T_VARIANTS: BoardCoord[][] = [
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
  ],
  [
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
    [3, 2],
    [2, 2],
    [1, 2],
    [0, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
  ],
  [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [2, 3],
    [2, 2],
    [2, 1],
    [2, 0],
  ],
];

export const BIG_H_VARIANTS: BoardCoord[][] = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [2, 1],
    [2, 2],
    [2, 3],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
    [1, 2],
    [2, 2],
    [3, 2],
  ],
];

const BIG_CROSS_CELLS: BoardCoord[] = [
  [2, 0],
  [2, 1],
  [2, 2],
  [2, 3],
  [2, 4],
  [0, 2],
  [1, 2],
  [3, 2],
  [4, 2],
];

const FOUR_CORNERS_CELLS: BoardCoord[] = [
  [0, 0],
  [0, 4],
  [4, 0],
  [4, 4],
];

const RIGHT_SHAPE_VARIANTS: BoardCoord[][] = [
  [
    [0, 0],
    [0, 1],
    [1, 0],
  ],
  [
    [0, 4],
    [0, 3],
    [1, 4],
  ],
  [
    [4, 0],
    [4, 1],
    [3, 0],
  ],
  [
    [4, 4],
    [4, 3],
    [3, 4],
  ],
];

function cellsTouchFree(cells: BoardCoord[]): boolean {
  return cells.some(
    ([row, col]) => row === FREE_CENTER[0] && col === FREE_CENTER[1],
  );
}

function isGroupComplete(
  boardRows: unknown[][],
  cells: BoardCoord[],
  calledNumbersSet: Set<number>,
): boolean {
  return (
    cells.length > 0 &&
    cells.every(([row, col]) =>
      isMarkedCellValue(boardRows[row]?.[col], calledNumbersSet),
    )
  );
}

function createInstance(
  kind: PatternKind,
  id: string,
  cells: BoardCoord[],
  boardRows: unknown[][],
  directionGroup?: DirectionGroup,
): PatternInstance {
  return {
    id,
    kind,
    cells,
    numbers: getPatternNumbers(boardRows, cells),
    touchesFree: cellsTouchFree(cells),
    usesDiagonal: directionGroup === 'DIAGONAL',
    directionGroup,
  };
}

function addCompletedRows(
  instances: PatternInstance[],
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
  kind: PatternKind,
  idPrefix: string,
): void {
  const boardRows = buildBoardRows(cartela);
  getCompletedRowIndexes(cartela, calledNumbersSet).forEach((rowNumber) => {
    const cells = buildRowCells(rowNumber - 1);
    instances.push(
      createInstance(
        kind,
        `${idPrefix}_ROW_${rowNumber}`,
        cells,
        boardRows,
        'ROW',
      ),
    );
  });
}

function addCompletedColumns(
  instances: PatternInstance[],
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
  kind: PatternKind,
  idPrefix: string,
): void {
  const boardRows = buildBoardRows(cartela);
  getCompletedColumnIndexes(cartela, calledNumbersSet).forEach(
    (columnIndex) => {
      const cells = buildColumnCells(columnIndex);
      instances.push(
        createInstance(
          kind,
          `${idPrefix}_COL_${COLUMN_LABELS[columnIndex]}`,
          cells,
          boardRows,
          'COLUMN',
        ),
      );
    },
  );
}

function addCompletedDiagonals(
  instances: PatternInstance[],
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
  kind: PatternKind,
  idPrefix: string,
): void {
  const boardRows = buildBoardRows(cartela);
  getCompletedDiagonalIndexes(cartela, calledNumbersSet).forEach(
    (diagonalIndex) => {
      const cells = buildDiagonalCells(diagonalIndex - 1);
      instances.push(
        createInstance(
          kind,
          `${idPrefix}_DIAG_${diagonalIndex}`,
          cells,
          boardRows,
          'DIAGONAL',
        ),
      );
    },
  );
}

function addCompletedCellGroups(
  instances: PatternInstance[],
  boardRows: unknown[][],
  calledNumbersSet: Set<number>,
  kind: PatternKind,
  idPrefix: string,
  groups: BoardCoord[][],
): void {
  groups.forEach((cells, index) => {
    if (isGroupComplete(boardRows, cells, calledNumbersSet)) {
      instances.push(
        createInstance(kind, `${idPrefix}_${index + 1}`, cells, boardRows),
      );
    }
  });
}

function addCompletedSquares2x2(
  instances: PatternInstance[],
  boardRows: unknown[][],
  calledNumbersSet: Set<number>,
): void {
  for (let row = 0; row <= 3; row += 1) {
    for (let col = 0; col <= 3; col += 1) {
      const cells: BoardCoord[] = [
        [row, col],
        [row, col + 1],
        [row + 1, col],
        [row + 1, col + 1],
      ];

      if (isGroupComplete(boardRows, cells, calledNumbersSet)) {
        instances.push(
          createInstance(
            'SQUARE_2X2',
            `SQUARE_2X2_R${row + 1}C${col + 1}`,
            cells,
            boardRows,
          ),
        );
      }
    }
  }
}

export function generateCompletedPatternInstances(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): PatternInstance[] {
  const boardRows = buildBoardRows(cartela);
  const instances: PatternInstance[] = [];

  addCompletedRows(instances, cartela, calledNumbersSet, 'ROW', 'ROW');
  addCompletedColumns(instances, cartela, calledNumbersSet, 'COLUMN', 'COLUMN');
  addCompletedDiagonals(
    instances,
    cartela,
    calledNumbersSet,
    'DIAGONAL',
    'DIAGONAL',
  );

  addCompletedRows(instances, cartela, calledNumbersSet, 'LINE', 'LINE');
  addCompletedColumns(instances, cartela, calledNumbersSet, 'LINE', 'LINE');
  addCompletedDiagonals(instances, cartela, calledNumbersSet, 'LINE', 'LINE');

  getCompletedRowIndexes(cartela, calledNumbersSet)
    .filter((rowNumber) => rowNumber === FREE_CENTER[0] + 1)
    .forEach((rowNumber) => {
      instances.push(
        createInstance(
          'LINE_TOUCHES_FREE',
          `LINE_TOUCHES_FREE_ROW_${rowNumber}`,
          buildRowCells(rowNumber - 1),
          boardRows,
          'ROW',
        ),
      );
    });
  getCompletedColumnIndexes(cartela, calledNumbersSet)
    .filter((columnIndex) => columnIndex === FREE_CENTER[1])
    .forEach((columnIndex) => {
      instances.push(
        createInstance(
          'LINE_TOUCHES_FREE',
          `LINE_TOUCHES_FREE_COL_${COLUMN_LABELS[columnIndex]}`,
          buildColumnCells(columnIndex),
          boardRows,
          'COLUMN',
        ),
      );
    });
  getCompletedDiagonalIndexes(cartela, calledNumbersSet).forEach(
    (diagonalIndex) => {
      instances.push(
        createInstance(
          'LINE_TOUCHES_FREE',
          `LINE_TOUCHES_FREE_DIAG_${diagonalIndex}`,
          buildDiagonalCells(diagonalIndex - 1),
          boardRows,
          'DIAGONAL',
        ),
      );
    },
  );

  getCompletedRowIndexes(cartela, calledNumbersSet)
    .filter((rowNumber) => rowNumber !== FREE_CENTER[0] + 1)
    .forEach((rowNumber) => {
      instances.push(
        createInstance(
          'LINES_WITHOUT_FREE',
          `LINES_WITHOUT_FREE_ROW_${rowNumber}`,
          buildRowCells(rowNumber - 1),
          boardRows,
          'ROW',
        ),
      );
    });
  getCompletedColumnIndexes(cartela, calledNumbersSet)
    .filter((columnIndex) => columnIndex !== FREE_CENTER[1])
    .forEach((columnIndex) => {
      instances.push(
        createInstance(
          'LINES_WITHOUT_FREE',
          `LINES_WITHOUT_FREE_COL_${COLUMN_LABELS[columnIndex]}`,
          buildColumnCells(columnIndex),
          boardRows,
          'COLUMN',
        ),
      );
    });

  addCompletedSquares2x2(instances, boardRows, calledNumbersSet);
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'BIG_L',
    'BIG_L',
    BIG_L_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'BIG_T',
    'BIG_T',
    BIG_T_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'BIG_H',
    'BIG_H',
    BIG_H_VARIANTS,
  );
  if (isGroupComplete(boardRows, BIG_CROSS_CELLS, calledNumbersSet)) {
    instances.push(
      createInstance('BIG_CROSS', 'BIG_CROSS_1', BIG_CROSS_CELLS, boardRows),
    );
  }
  if (isGroupComplete(boardRows, FOUR_CORNERS_CELLS, calledNumbersSet)) {
    instances.push(
      createInstance(
        'FOUR_CORNERS',
        'FOUR_CORNERS_1',
        FOUR_CORNERS_CELLS,
        boardRows,
      ),
    );
  }
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'RIGHT_SHAPE',
    'RIGHT_SHAPE',
    RIGHT_SHAPE_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'HALF_HOUSE_10_DIRECTION',
    'HALF_HOUSE_10',
    HALF_HOUSE_10_DIRECTION_CELLS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'HALF_HOUSE_4_DIRECTION',
    'HALF_HOUSE_4',
    HALF_HOUSE_4_DIRECTION_CELLS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'RECTANGLE_2X3_OR_3X2',
    'RECTANGLE',
    RECTANGLE_2X3_OR_3X2_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'SMALL_T',
    'SMALL_T',
    SMALL_T_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'TRIANGLE_6',
    'TRIANGLE_6',
    TRIANGLE_6_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'TRIANGLE_4X4',
    'TRIANGLE_4X4',
    TRIANGLE_4X4_VARIANTS,
  );
  addCompletedCellGroups(
    instances,
    boardRows,
    calledNumbersSet,
    'CORNER',
    'CORNER',
    CORNER_VARIANTS,
  );

  return instances;
}

export function patternCellsOverlap(
  left: PatternInstance,
  right: PatternInstance,
): boolean {
  const rightCells = new Set(right.cells.map(([row, col]) => `${row},${col}`));
  return left.cells.some(([row, col]) => rightCells.has(`${row},${col}`));
}

export function getMarkedNumbersOnBoard(
  cartela: EvaluatorCartela,
  calledNumbersSet: Set<number>,
): number[] {
  const boardRows = buildBoardRows(cartela);
  const numbers: number[] = [];

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const value = boardRows[row]?.[col];
      if (isMarkedCellValue(value, calledNumbersSet)) {
        const number = getCellNumber(value);
        if (number !== null) {
          numbers.push(number);
        }
      }
    }
  }

  return numbers;
}
