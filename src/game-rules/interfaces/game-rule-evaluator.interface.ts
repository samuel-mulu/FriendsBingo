import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import { BoardCoord } from '../patterns/pattern.types';

export interface EvaluatorCartela {
  id: string;
  number: number;
  b: unknown;
  i: unknown;
  n: unknown;
  g: unknown;
  o: unknown;
}

export interface CompletedPattern {
  type: string;
  key: string;
  numbers: number[];
  cells?: BoardCoord[];
}

export interface GameRuleEvaluationResult {
  isWinner: boolean;
  matchedPattern: string;
  progress: number;
  latestCalledNumber: number | null;
  completedByLatestNumber: boolean;
  completedPatterns: CompletedPattern[];
}

export interface GameRuleEvaluator {
  supports(gameType: string): boolean;
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    gameType: string,
  ): GameRuleEvaluationResult;
}
