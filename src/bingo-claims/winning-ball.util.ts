import { CalledNumberEvaluationRecord } from '../called-numbers/called-numbers.select';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { getLatestCalledNumber } from '../game-rules/evaluators/board.util';
import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
} from '../game-rules/interfaces/game-rule-evaluator.interface';

export type WinningBallRecord = {
  letter: string;
  number: number;
};

export function resolveWinningBallRecord(
  calledNumbers: Array<{ letter: string; number: number }>,
  winningBallNumber: number | null,
): WinningBallRecord | null {
  if (winningBallNumber === null) {
    return null;
  }

  const match = calledNumbers.find(
    (entry) => entry.number === winningBallNumber,
  );
  return match ? { letter: match.letter, number: match.number } : null;
}

export function resolveWinningBallFromEvaluation(
  calledNumbers: Array<{ letter: string; number: number }>,
  evaluation: Pick<GameRuleEvaluationResult, 'latestCalledNumber'>,
): WinningBallRecord | null {
  return resolveWinningBallRecord(calledNumbers, evaluation.latestCalledNumber);
}

export function resolveAcceptedEvaluation(
  evaluationService: GameRuleEvaluationService,
  cartela: EvaluatorCartela,
  calledNumbers: CalledNumberEvaluationRecord[],
  ruleKey: string,
  patterns?: unknown,
): GameRuleEvaluationResult {
  return evaluationService.evaluate(cartela, calledNumbers, ruleKey, patterns);
}

export function resolveWinningBallFromCalledNumbersSnapshot(
  calledNumbers: CalledNumberEvaluationRecord[],
): WinningBallRecord | null {
  const latestNumber = getLatestCalledNumber(calledNumbers);
  return resolveWinningBallRecord(calledNumbers, latestNumber);
}
