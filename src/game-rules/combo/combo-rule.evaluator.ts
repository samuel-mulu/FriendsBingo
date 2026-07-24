import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  CompletedPattern,
  EvaluatorCartela,
  GameRuleEvaluationResult,
} from '../interfaces/game-rule-evaluator.interface';
import {
  buildCalledNumbersSet,
  getLatestCalledNumber,
} from '../evaluators/board.util';
import { generateCompletedPatternInstances } from './base-pattern-generator';
import { ComboPattern, PatternInstance } from './combo.types';
import {
  computeComboProgress,
  isMinimumRuleSatisfied,
  solveCombo,
} from './combo-solver';

function toCompletedPatterns(patterns: PatternInstance[]): CompletedPattern[] {
  return patterns.map((pattern) => ({
    type: pattern.kind,
    key: pattern.id,
    cells: pattern.cells,
    numbers: pattern.numbers,
  }));
}

function resolveWinningComboPatterns(
  combo: ComboPattern,
  instances: PatternInstance[],
  latestCalledNumber: number | null,
): PatternInstance[] {
  if (!isMinimumRuleSatisfied(combo, instances)) {
    return [];
  }

  return solveCombo(combo, instances, {
    preferLatestCalledNumber: latestCalledNumber,
  }).selectedPatterns;
}

function computeCompletedByLatestNumber(
  combo: ComboPattern,
  instances: PatternInstance[],
  latestCalledNumber: number | null,
  isWinner: boolean,
): boolean {
  if (!isWinner || latestCalledNumber === null) {
    return false;
  }

  const winningPatterns = resolveWinningComboPatterns(
    combo,
    instances,
    latestCalledNumber,
  );

  return winningPatterns.some((pattern) =>
    pattern.numbers.includes(latestCalledNumber),
  );
}

export class ComboRuleEvaluator {
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberEvaluationRecord[],
    ruleKey: string,
    combo: ComboPattern,
  ): GameRuleEvaluationResult {
    const normalizedRuleKey = ruleKey.trim().toUpperCase();
    const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
    const latestCalledNumber = getLatestCalledNumber(calledNumbers);
    const instances = generateCompletedPatternInstances(
      cartela,
      calledNumbersSet,
    );
    const isWinner = isMinimumRuleSatisfied(combo, instances);
    const winningPatterns = isWinner
      ? resolveWinningComboPatterns(combo, instances, latestCalledNumber)
      : [];
    const completedPatterns = toCompletedPatterns(winningPatterns);
    const progress = isWinner ? 1 : computeComboProgress(combo, instances);
    const completedByLatestNumber = computeCompletedByLatestNumber(
      combo,
      instances,
      latestCalledNumber,
      isWinner,
    );

    return {
      isWinner,
      matchedPattern: isWinner
        ? `${normalizedRuleKey}:${completedPatterns.map((pattern) => pattern.key).join(',')}`
        : `${normalizedRuleKey}:NONE`,
      progress,
      latestCalledNumber,
      completedPatterns,
      completedByLatestNumber,
    };
  }
}
