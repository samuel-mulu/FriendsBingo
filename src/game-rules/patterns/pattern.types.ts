import { ComboPattern } from '../combo/combo.types';

export type BoardCoord = [row: number, col: number];

export type GameRulePattern =
  | { type: 'FULL_HOUSE' }
  | { type: 'ROWS_REQUIRED'; count: number }
  | { type: 'ANY_LINE' }
  | { type: 'ANY_ROW' }
  | { type: 'ANY_COLUMN' }
  | { type: 'ANY_DIAGONAL' }
  | { type: 'LINE_TOUCHES_FREE' }
  | { type: 'LINE_WITHOUT_FREE' }
  | { type: 'PATTERN_GROUP'; patterns: BoardCoord[][] }
  | ComboPattern;
