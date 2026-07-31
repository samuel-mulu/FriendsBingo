import { ComboPattern } from './combo.types';

export const COMBO_RULE_PATTERN_DEFINITIONS: Record<string, ComboPattern> = {
  TWO_COLUMNS_TWO_ROWS_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'COLUMN', count: 2 },
      { kind: 'ROW', count: 2 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  FOUR_SQUARES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [{ kind: 'SQUARE_2X2', count: 4 }],
  },
  THREE_COLUMNS_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'COLUMN', count: 3 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  BIG_T_TWO_SQUARES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'BIG_T', count: 1 },
      { kind: 'SQUARE_2X2', count: 2 },
    ],
  },
  FIVE_LINES: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'LINE', count: 5 }],
  },
  THREE_LINES_WITHOUT_FREE: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 3,
        constraints: { touchesFree: false },
      },
    ],
  },
  BIG_L_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'BIG_L', count: 1 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  TWO_ROWS_ONE_SQUARE: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'ROW', count: 2 },
      { kind: 'SQUARE_2X2', count: 1 },
    ],
  },
  COLUMNS_ROWS_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'COLUMN', count: 1 },
      { kind: 'ROW', count: 1 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  SEVEN_LINES: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'LINE', count: 7 }],
  },
  THREE_SQUARES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [{ kind: 'SQUARE_2X2', count: 3 }],
  },
  THREE_LINES_TOUCH_FREE: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 3,
        constraints: { touchesFree: true },
      },
    ],
  },
  TWO_COLUMNS_TWO_ROWS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'COLUMN', count: 2 },
      { kind: 'ROW', count: 2 },
    ],
  },
  ONE_LINE_WITH_FREE_TWO_LINES_WITHOUT_FREE: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 1,
        constraints: { touchesFree: true },
      },
      {
        kind: 'LINE',
        count: 2,
        constraints: { touchesFree: false },
      },
    ],
  },
  THREE_LINES: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'LINE', count: 3 }],
  },
  THREE_ROWS_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'ROW', count: 3 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  TWO_DIAGONALS_ONE_ROW: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'DIAGONAL', count: 2 },
      { kind: 'ROW', count: 1 },
    ],
  },
  THREE_PARALLEL_LINES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 3,
        constraints: { parallelOnly: true },
      },
    ],
  },
  FOUR_LINES_WITHOUT_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 4,
        constraints: { allowDiagonal: false },
      },
    ],
  },
  BIG_CROSS_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'BIG_CROSS', count: 1 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  SIX_LINES: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'LINE', count: 6 }],
  },
  THREE_COLUMNS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'COLUMN', count: 3 }],
  },
  FOUR_PARALLEL_LINES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      {
        kind: 'LINE',
        count: 4,
        constraints: { parallelOnly: true },
      },
    ],
  },
  FOUR_ANGLES_TWO_SQUARES: {
    type: 'COMBO',
    overlap: 'MIXED',
    requires: [
      { kind: 'FOUR_CORNERS', count: 1, group: 'ANGLES' },
      {
        kind: 'SQUARE_2X2',
        count: 2,
        group: 'SQUARES',
        mustNotOverlapGroups: ['SQUARES', 'ANGLES'],
      },
    ],
  },
  FOUR_LINES: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'LINE', count: 4 }],
  },
  THREE_ROWS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'ROW', count: 3 }],
  },
  TWO_ROWS_ONE_COLUMN: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'ROW', count: 2 },
      { kind: 'COLUMN', count: 1 },
    ],
  },
  TWO_DIAGONALS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'DIAGONAL', count: 2 }],
  },
  ONE_COLUMN_ONE_ROW_ONE_SQUARE: {
    type: 'COMBO',
    overlap: 'MIXED',
    requires: [
      { kind: 'COLUMN', count: 1, group: 'LINES' },
      { kind: 'ROW', count: 1, group: 'LINES' },
      {
        kind: 'SQUARE_2X2',
        count: 1,
        mustNotOverlapGroups: ['LINES'],
      },
    ],
  },
  BIG_T_ONE_DIAGONAL: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [
      { kind: 'BIG_T', count: 1 },
      { kind: 'DIAGONAL', count: 1 },
    ],
  },
  BIG_H: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'BIG_H', count: 1 }],
  },
  THREE_RECTANGLES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [{ kind: 'RECTANGLE_2X3_OR_3X2', count: 3 }],
  },
  BIG_T_TWO_LINES: {
    type: 'COMBO',
    overlap: 'MIXED',
    requires: [
      { kind: 'BIG_T', count: 1, group: 'BIG_T' },
      {
        kind: 'LINE',
        count: 2,
        group: 'LINES',
        mustNotBeContainedInGroups: ['BIG_T'],
      },
    ],
  },
  ONE_LINE_TWO_TRIANGLES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'LINE', count: 1 },
      { kind: 'TRIANGLE_6', count: 2 },
    ],
  },
  SMALL_T_TWO_SQUARES: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'SMALL_T', count: 1 },
      { kind: 'SQUARE_2X2', count: 2 },
    ],
  },
  ONE_LINE_TRIANGLE_4X4: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'LINE', count: 1 },
      { kind: 'TRIANGLE_4X4', count: 1 },
    ],
  },
  BIG_L_ONE_RECTANGLE: {
    type: 'COMBO',
    overlap: 'DISALLOW',
    requires: [
      { kind: 'BIG_L', count: 1 },
      { kind: 'RECTANGLE_2X3_OR_3X2', count: 1 },
    ],
  },
  TWO_ANGLES_THREE_LINES: {
    type: 'COMBO',
    overlap: 'MIXED',
    requires: [
      { kind: 'LINE', count: 3, group: 'LINES' },
      {
        kind: 'CORNER',
        count: 2,
        group: 'ANGLES',
        mustNotOverlapGroups: ['LINES'],
      },
    ],
  },
};

export const MIX_KEY_TO_COMBO_RULE: Record<
  string,
  keyof typeof COMBO_RULE_PATTERN_DEFINITIONS
> = {
  MIX_01: 'TWO_COLUMNS_TWO_ROWS_ONE_DIAGONAL',
  MIX_02: 'FOUR_SQUARES',
  MIX_03: 'THREE_COLUMNS_ONE_DIAGONAL',
  MIX_04: 'BIG_T_TWO_SQUARES',
  MIX_05: 'FIVE_LINES',
  MIX_06: 'THREE_LINES_WITHOUT_FREE',
  MIX_07: 'BIG_L_ONE_DIAGONAL',
  MIX_08: 'TWO_ROWS_ONE_SQUARE',
  MIX_09: 'COLUMNS_ROWS_DIAGONAL',
  MIX_10: 'SEVEN_LINES',
  MIX_11: 'THREE_SQUARES',
  MIX_12: 'THREE_LINES_TOUCH_FREE',
  MIX_13: 'TWO_COLUMNS_TWO_ROWS',
  MIX_14: 'ONE_LINE_WITH_FREE_TWO_LINES_WITHOUT_FREE',
};
