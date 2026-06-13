import { CalledNumberEvaluationRecord } from '../../called-numbers/called-numbers.select';
import {
  CompletedPattern,
  EvaluatorCartela,
  GameRuleEvaluationResult,
} from '../interfaces/game-rule-evaluator.interface';
import {
  buildCalledNumbersSet,
  getLatestCalledNumber,
  withoutLatestCalledNumber,
} from '../evaluators/board.util';
import { generateCompletedPatternInstances } from './base-pattern-generator';
import { ComboPattern, PatternInstance } from './combo.types';
import { computeComboProgress, solveCombo } from './combo-solver';

function toCompletedPatterns(patterns: PatternInstance[]): CompletedPattern[] {
  return patterns.map((pattern) => ({
    type: pattern.kind,
    key: pattern.id,
    cells: pattern.cells,
    numbers: pattern.numbers,
  }));
}

function findWinningCombination(
  combo: ComboPattern,
  instances: PatternInstance[],
): PatternInstance[] | null {
  const result = solveCombo(combo, instances);
  return result.isWinner ? result.selectedPatterns : null;
}

function computeCompletedByLatestNumber(
  combo: ComboPattern,
  cartela: EvaluatorCartela,
  calledNumbers: CalledNumberEvaluationRecord[],
  latestCalledNumber: number | null,
  currentSelection: PatternInstance[],
): boolean {
  if (latestCalledNumber === null || currentSelection.length === 0) {
    return false;
  }

  const latestParticipates = currentSelection.some((pattern) =>
    pattern.numbers.includes(latestCalledNumber),
  );
  if (!latestParticipates) {
    return false;
  }

  const beforeCalledNumbers = withoutLatestCalledNumber(calledNumbers);
  if (beforeCalledNumbers.length === 0) {
    return true;
  }

  const beforeSet = buildCalledNumbersSet(beforeCalledNumbers);
  const beforeInstances = generateCompletedPatternInstances(cartela, beforeSet);
  const beforeSelection = findWinningCombination(combo, beforeInstances);

  if (!beforeSelection) {
    return true;
  }

  const beforeCompleteIds = new Set(beforeInstances.map((pattern) => pattern.id));

  return currentSelection.some(
    (pattern) =>
      pattern.numbers.includes(latestCalledNumber) &&
      !beforeCompleteIds.has(pattern.id),
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
    const selection = findWinningCombination(combo, instances);
    const isWinner = selection !== null;
    const completedPatterns = toCompletedPatterns(selection ?? []);
    const progress = isWinner
      ? 1
      : computeComboProgress(combo, instances);
    const completedByLatestNumber = isWinner
      ? computeCompletedByLatestNumber(
          combo,
          cartela,
          calledNumbers,
          latestCalledNumber,
          selection ?? [],
        )
      : false;

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
