import { Prisma } from '@prisma/client';
import { BoardCoord, GameRulePattern } from './pattern.types';

export const FREE_CENTER: BoardCoord = [2, 2];

export const RULE_PATTERN_DEFINITIONS: Record<string, GameRulePattern> = {
  FULL_HOUSE: { type: 'FULL_HOUSE' },
  HALF_HOUSE: { type: 'ROWS_REQUIRED', count: 3 },
  LINE: { type: 'ANY_LINE' },
  ROWS: { type: 'ANY_ROW' },
  COLUMNS: { type: 'ANY_COLUMN' },
  DIAGONAL: { type: 'ANY_DIAGONAL' },
  LINE_TOUCHES_FREE: { type: 'LINE_TOUCHES_FREE' },
  LINES_WITHOUT_FREE: { type: 'LINE_WITHOUT_FREE' },
  BIG_T: {
    type: 'PATTERN_GROUP',
    patterns: [
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
    ],
  },
  BIG_L_SHAPE: {
    type: 'PATTERN_GROUP',
    patterns: [
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
    ],
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
};

export const RULE_ACTIVE_KEYS = new Set([
  'FULL_HOUSE',
  'HALF_HOUSE',
  'LINE',
  'ROWS',
  'COLUMNS',
  'DIAGONAL',
]);

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
    default:
      return null;
  }
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
