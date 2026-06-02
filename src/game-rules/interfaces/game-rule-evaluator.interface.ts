import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';

export interface EvaluatorCartela {
  id: string;
  number: number;
  b: unknown;
  i: unknown;
  n: unknown;
  g: unknown;
  o: unknown;
}

export interface GameRuleEvaluationResult {
  isWinner: boolean;
  matchedPattern: string;
  progress: number;
}

export interface GameRuleEvaluator {
  supports(gameType: string): boolean;
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    gameType: string,
  ): GameRuleEvaluationResult;
}
