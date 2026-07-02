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
import {
  computeComboProgress,
  findAllWinningCombinations,
  isCombinationNewlyCompletedByLatestNumber,
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

function findWinningCombination(
  combo: ComboPattern,
  instances: PatternInstance[],
  latestCalledNumber?: number | null,
): PatternInstance[] | null {
  const result = solveCombo(combo, instances, {
    preferLatestCalledNumber: latestCalledNumber,
  });
  return result.isWinner ? result.selectedPatterns : null;
}

function computeCompletedByLatestNumber(
  combo: ComboPattern,
  cartela: EvaluatorCartela,
  calledNumbers: CalledNumberEvaluationRecord[],
  latestCalledNumber: number | null,
): boolean {
  if (latestCalledNumber === null) {
    return false;
  }

  const calledNumbersSet = buildCalledNumbersSet(calledNumbers);
  const instances = generateCompletedPatternInstances(cartela, calledNumbersSet);
  const winningCombinations = findAllWinningCombinations(combo, instances);

  if (winningCombinations.length === 0) {
    return false;
  }

  const beforeCalledNumbers = withoutLatestCalledNumber(calledNumbers);
  const beforeInstances = generateCompletedPatternInstances(
    cartela,
    buildCalledNumbersSet(beforeCalledNumbers),
  );
  const beforeCompletePatternIds = new Set(
    beforeInstances.map((pattern) => pattern.id),
  );
  const beforeWinningCombinations = findAllWinningCombinations(
    combo,
    beforeInstances,
  );

  if (beforeWinningCombinations.length > 0) {
    return false;
  }

  return winningCombinations.some((combination) =>
    isCombinationNewlyCompletedByLatestNumber(
      combination,
      latestCalledNumber,
      beforeCompletePatternIds,
    ),
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
    const selection = findWinningCombination(
      combo,
      instances,
      latestCalledNumber,
    );
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
