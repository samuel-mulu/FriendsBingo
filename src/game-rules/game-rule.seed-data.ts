import { Prisma } from '@prisma/client';
import {
  RULE_ACTIVE_KEYS,
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

const ruleNames: Array<
  Pick<SeedGameRuleDefinition, 'key' | 'name'> &
    Partial<Pick<SeedGameRuleDefinition, 'isActive' | 'description'>>
> = [
  { key: 'MANUAL', name: 'Manual', isActive: false },
  { key: 'FULL_HOUSE', name: 'FULL-HOUSE' },
  { key: 'HALF_HOUSE', name: 'Half House' },
  { key: 'LINE', name: 'line' },
  { key: 'COLUMNS', name: 'Columns' },
  { key: 'ROWS', name: 'Rows' },
  { key: 'DIAGONAL', name: 'Diagonal' },
  { key: 'FOUR_CORNERS', name: 'Four Corners' },
  { key: 'LINE_TOUCHES_FREE', name: 'Line touches free' },
  { key: 'LINES_WITHOUT_FREE', name: 'lines without free' },
  { key: 'SQUARE', name: 'Square' },
  { key: 'RECTANGLE', name: 'Rectangule' },
  { key: 'TWO_TRIANGLE', name: '2 triangle' },
  { key: 'FOUR_BY_FOUR_TRIANGLE', name: '4 by 4 triangle' },
  { key: 'PYRAMID', name: 'Pyramid' },
  { key: 'BIG_L_SHAPE', name: 'BIG L Shape' },
  { key: 'BIG_T', name: 'BIG T' },
  { key: 'BIG_H', name: 'BIG H' },
  { key: 'BIG_N', name: 'BIG N' },
  { key: 'BIG_Y', name: 'BIG Y' },
  { key: 'BIG_CROSS', name: 'BIG Cross' },
  { key: 'RIGHT_SHAPE', name: 'RIGHT Shape' },
  { key: 'SMALL_T', name: 'small T' },
  { key: 'SMALL_X', name: 'small X' },
  { key: 'SMALL_O', name: 'small O' },
  { key: 'SMALL_H', name: 'small H' },
  { key: 'SMALL_CROSS', name: 'small cross' },
  { key: 'SMALL_L', name: 'small L' },
  { key: 'MIXED_JOIN', name: 'Mixed Join' },
  { key: 'MIX_01', name: 'mix_01' },
  { key: 'MIX_02', name: 'mix_02' },
  { key: 'MIX_03', name: 'mix_03' },
  { key: 'MIX_04', name: 'mix_04' },
  { key: 'MIX_05', name: 'mix_05' },
  { key: 'MIX_06', name: 'mix_06' },
  { key: 'MIX_07', name: 'mix_07' },
  { key: 'MIX_08', name: 'mix_08' },
  { key: 'MIX_09', name: 'mix_09' },
  { key: 'MIX_10', name: 'mix_10' },
  { key: 'MIX_11', name: 'mix_11' },
  { key: 'MIX_12', name: 'mix_12' },
  { key: 'MIX_13', name: 'mix_13' },
  { key: 'MIX_14', name: 'mix_14' },
  {
    key: 'HALF_HOUSE_4_DIRECTIONS',
    name: 'Half House 4 Directions',
    isActive: false,
    description: 'Pending rule definition',
  },
  {
    key: 'HALF_HOUSE_10_DIRECTIONS',
    name: 'Half House 10 Directions',
    isActive: false,
    description: 'Pending rule definition',
  },
  { key: 'THREE_LINES', name: 'Three Lines' },
  { key: 'THREE_ROWS', name: 'Three Rows' },
  { key: 'THREE_COLUMNS', name: 'Three Columns' },
  { key: 'FOUR_LINES', name: 'Four Lines' },
  { key: 'FIVE_LINES', name: 'Five Lines' },
  { key: 'SIX_LINES', name: 'Six Lines' },
  { key: 'SEVEN_LINES', name: 'Seven Lines' },
  { key: 'TWO_DIAGONALS', name: 'Two Diagonals' },
  { key: 'BIG_T_ONE_DIAGONAL', name: 'Big T + Diagonal' },
  { key: 'BIG_L_ONE_DIAGONAL', name: 'Big L + Diagonal' },
  { key: 'BIG_CROSS_ONE_DIAGONAL', name: 'Big Cross + Diagonal' },
] as const;

export const seededGameRules: SeedGameRuleDefinition[] = ruleNames.map(
  (rule, index) => {
    const patternDefinition = RULE_PATTERN_DEFINITIONS[rule.key];

    return {
      ...rule,
      isActive: rule.isActive ?? RULE_ACTIVE_KEYS.has(rule.key),
      sortOrder: index + 1,
      description: rule.description,
      patterns: patternDefinition
        ? toSeedPatternJson(patternDefinition)
        : undefined,
    };
  },
);
