import { BoardCoord } from '../patterns/pattern.types';

export type PatternKind =
  | 'LINE'
  | 'ROW'
  | 'COLUMN'
  | 'DIAGONAL'
  | 'LINE_TOUCHES_FREE'
  | 'LINES_WITHOUT_FREE'
  | 'SQUARE_2X2'
  | 'BIG_L'
  | 'BIG_T'
  | 'BIG_H'
  | 'BIG_CROSS'
  | 'FOUR_CORNERS'
  | 'RIGHT_SHAPE'
  | 'HALF_HOUSE_10_DIRECTION'
  | 'HALF_HOUSE_4_DIRECTION'
  | 'RECTANGLE_2X3_OR_3X2'
  | 'TRIANGLE_6'
  | 'TRIANGLE_4X4'
  | 'SMALL_T'
  | 'CORNER';

export type OverlapMode = 'ALLOW' | 'DISALLOW' | 'MIXED';

export type DirectionGroup = 'ROW' | 'COLUMN' | 'DIAGONAL';

export interface PatternConstraints {
  touchesFree?: boolean;
  allowDiagonal?: boolean;
  parallelOnly?: boolean;
}

export interface ComboRequirement {
  kind: PatternKind;
  count: number;
  group?: string;
  mustNotOverlapGroups?: string[];
  /**
   * Groups whose selected pattern must not already contain this one. Crossing
   * the other pattern stays legal; only being fully swallowed by it is
   * rejected, so a big T cannot double as one of the lines it is made of.
   */
  mustNotBeContainedInGroups?: string[];
  constraints?: PatternConstraints;
}

export interface ComboPattern {
  type: 'COMBO';
  overlap: OverlapMode;
  requires: ComboRequirement[];
}

export interface PatternInstance {
  id: string;
  kind: PatternKind;
  cells: BoardCoord[];
  numbers: number[];
  touchesFree: boolean;
  usesDiagonal: boolean;
  directionGroup?: DirectionGroup;
}

export interface ComboSolveResult {
  isWinner: boolean;
  selectedPatterns: PatternInstance[];
}
