import { Prisma } from '@prisma/client';
import {
  FINAL_PRODUCT_RULE_KEYS,
  RULE_PATTERN_DEFINITIONS,
  toSeedPatternJson,
} from './patterns/game-rule.patterns';

export interface SeedGameRuleDefinition {
  key: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  description?: string;
  patterns?: Prisma.InputJsonValue;
}

const LEGACY_REMOVED_KEYS = [
  'MANUAL',
  'HALF_HOUSE',
  'LINE',
  'COLUMNS',
  'ROWS',
  'DIAGONAL',
  'FOUR_CORNERS',
  'LINE_TOUCHES_FREE',
  'LINES_WITHOUT_FREE',
  'SQUARE',
  'RECTANGLE',
  'TWO_TRIANGLE',
  'FOUR_BY_FOUR_TRIANGLE',
  'PYRAMID',
  'BIG_L_SHAPE',
  'BIG_T',
  'BIG_N',
  'BIG_Y',
  'BIG_CROSS',
  'RIGHT_SHAPE',
  'SMALL_T',
  'SMALL_X',
  'SMALL_O',
  'SMALL_H',
  'SMALL_CROSS',
  'SMALL_L',
  'MIXED_JOIN',
  'FIVE_LINES',
  'SEVEN_LINES',
  'BIG_L_ONE_DIAGONAL',
] as const;

export { FINAL_PRODUCT_RULE_KEYS };

const ruleNames: Array<
  Pick<SeedGameRuleDefinition, 'key' | 'name' | 'description'>
> = [
  {
    key: 'FULL_HOUSE',
    name: 'Full House',
    description: 'Complete all 25 cells on the cartela.',
  },
  {
    key: 'MIX_01',
    name: '2 Col + 2 Row + 1 Diag',
    description: 'Complete 2 columns, 2 rows, and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'MIX_02',
    name: '4 Squares',
    description: 'Complete 4 separate 2x2 squares. Overlap not allowed.',
  },
  {
    key: 'MIX_03',
    name: '3 Col + 1 Diag',
    description: 'Complete 3 columns and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'MIX_04',
    name: 'Big T + 2 Squares',
    description: 'Complete a big T and 2 squares. Overlap not allowed.',
  },
  {
    key: 'MIX_05',
    name: '5 Lines',
    description:
      'Complete 5 lines (row, column, or diagonal). Overlap allowed.',
  },
  {
    key: 'MIX_06',
    name: '3 Lines Without Free',
    description:
      'Complete 3 lines that do not pass through FREE. Overlap allowed.',
  },
  {
    key: 'MIX_07',
    name: 'Big L + 1 Diag',
    description: 'Complete a big L and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'MIX_08',
    name: '2 Rows + 1 Square',
    description: 'Complete 2 rows and 1 square. Overlap not allowed.',
  },
  {
    key: 'MIX_09',
    name: '1 Col + 1 Row + 1 Diag',
    description: 'Complete 1 column, 1 row, and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'MIX_10',
    name: '7 Lines',
    description:
      'Complete 7 lines (row, column, or diagonal). Overlap allowed.',
  },
  {
    key: 'MIX_11',
    name: '3 Squares',
    description: 'Complete 3 separate 2x2 squares. Overlap not allowed.',
  },
  {
    key: 'MIX_12',
    name: '3 Lines Touching Free',
    description: 'Complete 3 lines that pass through FREE. Overlap allowed.',
  },
  {
    key: 'BIG_H',
    name: 'Big H',
    description: 'Complete the big H shape pattern. Overlap allowed.',
  },
  {
    key: 'MIX_13',
    name: '2 Col + 2 Row',
    description: 'Complete 2 columns and 2 rows. Overlap allowed.',
  },
  {
    key: 'HALF_HOUSE_10_DIRECTIONS',
    name: 'Half House',
    description: 'Complete one of the 10 half-house patterns.',
  },
  {
    key: 'THREE_LINES',
    name: '3 Lines',
    description:
      'Complete 3 lines (row, column, or diagonal). Overlap allowed.',
  },
  {
    key: 'THREE_ROWS_ONE_DIAGONAL',
    name: '3 Rows + 1 Diag',
    description: 'Complete 3 rows and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'TWO_DIAGONALS_ONE_ROW',
    name: '2 Diags + 1 Row',
    description: 'Complete 2 diagonals and 1 row. Overlap allowed.',
  },
  {
    key: 'THREE_PARALLEL_LINES',
    name: '3 Parallel Lines',
    description:
      'Complete 3 parallel lines (all rows or all columns). Overlap not allowed.',
  },
  {
    key: 'FOUR_LINES_WITHOUT_DIAGONAL',
    name: '4 Lines Without Diag',
    description:
      'Complete 4 lines using rows/columns only (no diagonals). Overlap allowed.',
  },
  {
    key: 'HALF_HOUSE_4_DIRECTIONS',
    name: 'Half House 4 Directions',
    description: 'Complete one of the 4 diagonal half-house patterns.',
  },
  {
    key: 'MIX_14',
    name: '1 Line With Free + 2 Without',
    description:
      'Complete 1 line through FREE and 2 lines that avoid FREE. Overlap allowed.',
  },
  {
    key: 'BIG_CROSS_ONE_DIAGONAL',
    name: 'Big Cross + 1 Diag',
    description: 'Complete a big cross and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'TWO_ROWS_ONE_SQUARE_ALT',
    name: '2 Rows + 1 Square',
    description: 'Complete 2 rows and 1 square. Overlap not allowed.',
  },
  {
    key: 'SIX_LINES',
    name: '6 Lines',
    description:
      'Complete 6 lines (row, column, or diagonal). Overlap allowed.',
  },
  {
    key: 'THREE_COLUMNS',
    name: '3 Columns',
    description: 'Complete any 3 full columns. Overlap allowed.',
  },
  {
    key: 'FOUR_PARALLEL_LINES',
    name: '4 Parallel Lines',
    description:
      'Complete 4 parallel lines (all rows or all columns). Overlap not allowed.',
  },
  {
    key: 'FOUR_ANGLES_TWO_SQUARES',
    name: '4 Angles + 2 Squares',
    description:
      'Complete the 4 corner cells and 2 squares. Squares must not overlap each other or any corner cell.',
  },
  {
    key: 'FOUR_LINES',
    name: '4 Lines',
    description:
      'Complete 4 lines (row, column, or diagonal). Overlap allowed.',
  },
  {
    key: 'THREE_ROWS',
    name: '3 Rows',
    description: 'Complete any 3 full rows. Overlap allowed.',
  },
  {
    key: 'TWO_ROWS_ONE_COLUMN',
    name: '2 Rows + 1 Col',
    description: 'Complete 2 rows and 1 column. Overlap allowed.',
  },
  {
    key: 'TWO_DIAGONALS',
    name: '2 Diagonals',
    description: 'Complete both diagonals. Overlap allowed.',
  },
  {
    key: 'ONE_COLUMN_ONE_ROW_ONE_SQUARE',
    name: '1 Col + 1 Row + 1 Square',
    description:
      'Complete 1 column, 1 row, and 1 square. Column and row may overlap; square must not overlap the line patterns.',
  },
  {
    key: 'BIG_T_ONE_DIAGONAL',
    name: 'Big T + 1 Diag',
    description: 'Complete a big T and 1 diagonal. Overlap allowed.',
  },
  {
    key: 'BIG_N_OR_Z',
    name: 'Big N / Z',
    description: 'Complete the big N or the big Z (2 orientations).',
  },
  {
    key: 'BIG_M_OR_W',
    name: 'Big M / W',
    description:
      'Complete the big M, big W, or either sideways orientation (4 options).',
  },
  {
    key: 'THREE_RECTANGLES',
    name: '3 Rectangles',
    description:
      'Complete 3 non-overlapping rectangles. Each rectangle is 3x2 or 2x3.',
  },
  {
    key: 'BIG_T_TWO_LINES',
    name: 'Big T & 2 Lines',
    description:
      "Complete a big T plus 2 more lines (row, column, or diagonal). The 2 lines must be different from the T's own row and column, but they may cross it.",
  },
  {
    key: 'ONE_LINE_TWO_TRIANGLES',
    name: '1 Line & 2 Triangles',
    description:
      'Complete 1 line and 2 triangles. Overlap not allowed.',
  },
  {
    key: 'SMALL_T_TWO_SQUARES',
    name: 'Small T & 2 Squares',
    description:
      'Complete 1 small T and 2 squares. Overlap not allowed.',
  },
  {
    key: 'ONE_LINE_TRIANGLE_4X4',
    name: '1 Line & Triangle 4x4',
    description:
      'Complete 1 line and one 4x4 triangle. Overlap not allowed.',
  },
  {
    key: 'BIG_L_ONE_RECTANGLE',
    name: 'Big L & Rectangle',
    description:
      'Complete a big L and 1 rectangle (2x3 or 3x2). Overlap not allowed.',
  },
  {
    key: 'TWO_ANGLES_THREE_LINES',
    name: '2 Angles & 3 Lines',
    description:
      'Complete 2 of the 4 corner angles and 3 lines. Lines may overlap; angles must not sit on the lines.',
  },
] as const;

export const seededGameRules: SeedGameRuleDefinition[] = ruleNames.map(
  (rule, index) => {
    const patternDefinition = RULE_PATTERN_DEFINITIONS[rule.key];
    if (!patternDefinition) {
      throw new Error(`Missing pattern definition for seed rule ${rule.key}`);
    }

    return {
      ...rule,
      isActive: true,
      sortOrder: index + 1,
      patterns: toSeedPatternJson(patternDefinition),
    };
  },
);

export const LEGACY_GAME_RULE_KEYS = LEGACY_REMOVED_KEYS;
