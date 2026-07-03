import { CompletedPattern } from '../interfaces/game-rule-evaluator.interface';

function patternIncludesLatest(
  pattern: CompletedPattern,
  latestCalledNumber: number,
): boolean {
  return pattern.numbers.includes(latestCalledNumber);
}

function comparePatternPreference(
  left: CompletedPattern,
  right: CompletedPattern,
  latestCalledNumber: number | null,
): number {
  if (latestCalledNumber === null) {
    return 0;
  }

  const leftHasLatest = patternIncludesLatest(left, latestCalledNumber);
  const rightHasLatest = patternIncludesLatest(right, latestCalledNumber);
  if (leftHasLatest === rightHasLatest) {
    return 0;
  }

  return leftHasLatest ? -1 : 1;
}

/**
 * Caps winner-pattern overlays to the rule minimum and prefers patterns that
 * contain the active (latest called) ball.
 */
export function selectCompletedPatternsForDisplay(
  patterns: CompletedPattern[],
  {
    requiredCount,
    latestCalledNumber = null,
  }: {
    requiredCount?: number;
    latestCalledNumber?: number | null;
  } = {},
): CompletedPattern[] {
  if (patterns.length === 0) {
    return patterns;
  }

  const sorted = [...patterns].sort((left, right) =>
    comparePatternPreference(left, right, latestCalledNumber),
  );

  if (requiredCount === undefined) {
    if (latestCalledNumber === null || patterns.length === 1) {
      return sorted;
    }

    const withLatest = sorted.filter((pattern) =>
      patternIncludesLatest(pattern, latestCalledNumber),
    );
    return withLatest.length > 0 ? [withLatest[0]] : [sorted[0]];
  }

  return sorted.slice(0, requiredCount);
}
