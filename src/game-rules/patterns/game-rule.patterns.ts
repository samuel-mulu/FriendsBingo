import { Prisma } from '@prisma/client';
import {
  COMBO_RULE_PATTERN_DEFINITIONS,
  MIX_KEY_TO_COMBO_RULE,
} from '../combo/combo-pattern-definitions';
import {
  BIG_L_VARIANTS,
  BIG_T_VARIANTS,
} from '../combo/base-pattern-generator';
import {
  ComboPattern,
  ComboRequirement,
  OverlapMode,
  PatternConstraints,
  PatternKind,
} from '../combo/combo.types';
import { BoardCoord, GameRulePattern } from './pattern.types';

export const FREE_CENTER: BoardCoord = [2, 2];

const LEGACY_RULE_PATTERN_DEFINITIONS: Record<string, GameRulePattern> = {
  FULL_HOUSE: { type: 'FULL_HOUSE' },
  HALF_HOUSE: { type: 'ROWS_REQUIRED', count: 3 },
  LINE: { type: 'ANY_LINE' },
  ROWS: { type: 'ANY_ROW' },
  COLUMNS: { type: 'ANY_COLUMN' },
  DIAGONAL: { type: 'ANY_DIAGONAL' },
  FOUR_CORNERS: {
    type: 'PATTERN_GROUP',
    patterns: [[[0, 0], [0, 4], [4, 0], [4, 4]]],
  },
  LINE_TOUCHES_FREE: { type: 'LINE_TOUCHES_FREE' },
  LINES_WITHOUT_FREE: { type: 'LINE_WITHOUT_FREE' },
  BIG_T: {
    type: 'PATTERN_GROUP',
    patterns: BIG_T_VARIANTS,
  },
  BIG_L_SHAPE: {
    type: 'PATTERN_GROUP',
    patterns: BIG_L_VARIANTS,
  },
  BIG_CROSS: {
    type: 'PATTERN_GROUP',
    patterns: [
      [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
        [0, 2],
        [1, 2],
        [3, 2],
        [4, 2],
      ],
    ],
  },
  SMALL_T: {
    type: 'PATTERN_GROUP',
    patterns: [
      [
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 2],
        [3, 2],
      ],
    ],
  },
  SMALL_X: {
    type: 'PATTERN_GROUP',
    patterns: [
      [
        [0, 0],
        [0, 4],
        [1, 1],
        [1, 3],
        [2, 2],
        [3, 1],
        [3, 3],
        [4, 0],
        [4, 4],
      ],
    ],
  },
  SMALL_CROSS: {
    type: 'PATTERN_GROUP',
    patterns: [
      [
        [1, 2],
        [2, 1],
        [2, 2],
        [2, 3],
        [3, 2],
      ],
    ],
  },
  HALF_HOUSE_10_DIRECTIONS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'HALF_HOUSE_10_DIRECTION', count: 1 }],
  },
  HALF_HOUSE_4_DIRECTIONS: {
    type: 'COMBO',
    overlap: 'ALLOW',
    requires: [{ kind: 'HALF_HOUSE_4_DIRECTION', count: 1 }],
  },
};

const MIX_RULE_PATTERN_DEFINITIONS = Object.fromEntries(
  Object.entries(MIX_KEY_TO_COMBO_RULE).map(([mixKey, comboKey]) => [
    mixKey,
    COMBO_RULE_PATTERN_DEFINITIONS[comboKey],
  ]),
) as Record<string, GameRulePattern>;

export const RULE_PATTERN_DEFINITIONS: Record<string, GameRulePattern> = {
  ...LEGACY_RULE_PATTERN_DEFINITIONS,
  ...COMBO_RULE_PATTERN_DEFINITIONS,
  ...MIX_RULE_PATTERN_DEFINITIONS,
  TWO_ROWS_ONE_SQUARE_ALT: COMBO_RULE_PATTERN_DEFINITIONS.TWO_ROWS_ONE_SQUARE,
};

/** Final 35 product game rules (stable keys). */
export const PRODUCT_RULE_KEYS = [
  'FULL_HOUSE',
  'MIX_01',
  'MIX_02',
  'MIX_03',
  'MIX_04',
  'MIX_05',
  'MIX_06',
  'MIX_07',
  'MIX_08',
  'MIX_09',
  'MIX_10',
  'MIX_11',
  'MIX_12',
  'BIG_H',
  'MIX_13',
  'HALF_HOUSE_10_DIRECTIONS',
  'THREE_LINES',
  'THREE_ROWS_ONE_DIAGONAL',
  'TWO_DIAGONALS_ONE_ROW',
  'THREE_PARALLEL_LINES',
  'FOUR_LINES_WITHOUT_DIAGONAL',
  'HALF_HOUSE_4_DIRECTIONS',
  'MIX_14',
  'BIG_CROSS_ONE_DIAGONAL',
  'TWO_ROWS_ONE_SQUARE_ALT',
  'SIX_LINES',
  'THREE_COLUMNS',
  'FOUR_PARALLEL_LINES',
  'FOUR_ANGLES_TWO_SQUARES',
  'FOUR_LINES',
  'THREE_ROWS',
  'TWO_ROWS_ONE_COLUMN',
  'TWO_DIAGONALS',
  'ONE_COLUMN_ONE_ROW_ONE_SQUARE',
  'BIG_T_ONE_DIAGONAL',
] as const;

export const FINAL_PRODUCT_RULE_KEYS = PRODUCT_RULE_KEYS;

export type ProductRuleKey = (typeof PRODUCT_RULE_KEYS)[number];

export const RULE_ACTIVE_KEYS = new Set<string>(PRODUCT_RULE_KEYS);

export function getRulePattern(ruleKey: string): GameRulePattern | null {
  return RULE_PATTERN_DEFINITIONS[ruleKey.trim().toUpperCase()] ?? null;
}

export function parseGameRulePattern(patterns: unknown): GameRulePattern | null {
  if (!patterns || typeof patterns !== 'object') {
    return null;
  }

  const candidate = patterns as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? candidate.type : null;
  if (!type) {
    return null;
  }

  switch (type) {
    case 'FULL_HOUSE':
      return { type: 'FULL_HOUSE' };
    case 'ROWS_REQUIRED':
      return typeof candidate.count === 'number' && candidate.count > 0
        ? { type: 'ROWS_REQUIRED', count: candidate.count }
        : null;
    case 'ANY_LINE':
      return { type: 'ANY_LINE' };
    case 'ANY_ROW':
      return { type: 'ANY_ROW' };
    case 'ANY_COLUMN':
      return { type: 'ANY_COLUMN' };
    case 'ANY_DIAGONAL':
      return { type: 'ANY_DIAGONAL' };
    case 'LINE_TOUCHES_FREE':
      return { type: 'LINE_TOUCHES_FREE' };
    case 'LINE_WITHOUT_FREE':
      return { type: 'LINE_WITHOUT_FREE' };
    case 'PATTERN_GROUP':
      if (!Array.isArray(candidate.patterns)) {
        return null;
      }

      const parsedPatterns = candidate.patterns
        .map((entry) => parsePatternGroup(entry))
        .filter((entry): entry is BoardCoord[] => entry !== null);

      return parsedPatterns.length > 0
        ? { type: 'PATTERN_GROUP', patterns: parsedPatterns }
        : null;
    case 'COMBO':
      return parseComboPattern(candidate);
    default:
      return null;
  }
}

function parseComboPattern(candidate: Record<string, unknown>): ComboPattern | null {
  const overlap = candidate.overlap;
  if (
    overlap !== 'ALLOW' &&
    overlap !== 'DISALLOW' &&
    overlap !== 'MIXED'
  ) {
    return null;
  }

  if (!Array.isArray(candidate.requires)) {
    return null;
  }

  const requires = candidate.requires
    .map((entry) => parseComboRequirement(entry))
    .filter((entry): entry is ComboRequirement => entry !== null);

  if (requires.length === 0) {
    return null;
  }

  return {
    type: 'COMBO',
    overlap: overlap as OverlapMode,
    requires,
  };
}

function parseComboRequirement(value: unknown): ComboRequirement | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  const count = candidate.count;

  if (typeof kind !== 'string' || typeof count !== 'number' || count <= 0) {
    return null;
  }

  const parsedKind = kind.trim().toUpperCase() as PatternKind;
  const validKinds: PatternKind[] = [
    'LINE',
    'ROW',
    'COLUMN',
    'DIAGONAL',
    'LINE_TOUCHES_FREE',
    'LINES_WITHOUT_FREE',
    'SQUARE_2X2',
    'BIG_L',
    'BIG_T',
    'BIG_H',
    'BIG_CROSS',
    'RIGHT_SHAPE',
    'HALF_HOUSE_10_DIRECTION',
    'HALF_HOUSE_4_DIRECTION',
  ];

  if (!validKinds.includes(parsedKind)) {
    return null;
  }

  const requirement: ComboRequirement = {
    kind: parsedKind,
    count,
  };

  if (typeof candidate.group === 'string' && candidate.group.trim().length > 0) {
    requirement.group = candidate.group.trim();
  }

  if (Array.isArray(candidate.mustNotOverlapGroups)) {
    const groups = candidate.mustNotOverlapGroups.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
    if (groups.length > 0) {
      requirement.mustNotOverlapGroups = groups;
    }
  }

  const constraints = parsePatternConstraints(candidate.constraints);
  if (constraints) {
    requirement.constraints = constraints;
  }

  return requirement;
}

function parsePatternConstraints(value: unknown): PatternConstraints | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const constraints: PatternConstraints = {};

  if (typeof candidate.touchesFree === 'boolean') {
    constraints.touchesFree = candidate.touchesFree;
  }
  if (typeof candidate.allowDiagonal === 'boolean') {
    constraints.allowDiagonal = candidate.allowDiagonal;
  }
  if (typeof candidate.parallelOnly === 'boolean') {
    constraints.parallelOnly = candidate.parallelOnly;
  }

  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function parsePatternGroup(value: unknown): BoardCoord[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const coords: BoardCoord[] = [];
  for (const cell of value) {
    if (!Array.isArray(cell) || cell.length !== 2) {
      return null;
    }

    const row = cell[0];
    const col = cell[1];
    if (
      typeof row !== 'number' ||
      typeof col !== 'number' ||
      row < 0 ||
      row > 4 ||
      col < 0 ||
      col > 4
    ) {
      return null;
    }

    coords.push([row, col]);
  }

  return coords.length > 0 ? coords : null;
}

export function toSeedPatternJson(
  pattern: GameRulePattern,
): Prisma.InputJsonValue {
  return pattern as Prisma.InputJsonValue;
}
