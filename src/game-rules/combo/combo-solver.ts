import {
  ComboPattern,
  ComboRequirement,
  ComboSolveResult,
  PatternConstraints,
  PatternInstance,
} from './combo.types';
import {
  patternCellsOverlap,
  patternContainsPattern,
} from './base-pattern-generator';

interface RequirementPool {
  requirement: ComboRequirement;
  candidates: PatternInstance[];
}

export interface SolveComboOptions {
  preferLatestCalledNumber?: number | null;
}

function matchesConstraints(
  instance: PatternInstance,
  constraints?: PatternConstraints,
): boolean {
  if (!constraints) {
    return true;
  }

  if (
    constraints.touchesFree !== undefined &&
    instance.touchesFree !== constraints.touchesFree
  ) {
    return false;
  }

  if (constraints.allowDiagonal === false && instance.usesDiagonal) {
    return false;
  }

  return true;
}

export function filterCandidates(
  instances: PatternInstance[],
  requirement: ComboRequirement,
): PatternInstance[] {
  return instances.filter(
    (instance) =>
      instance.kind === requirement.kind &&
      matchesConstraints(instance, requirement.constraints),
  );
}

function buildRequirementPools(
  combo: ComboPattern,
  instances: PatternInstance[],
): RequirementPool[] {
  return combo.requires.map((requirement) => ({
    requirement,
    candidates: filterCandidates(instances, requirement),
  }));
}

export function isMinimumRuleSatisfied(
  combo: ComboPattern,
  instances: PatternInstance[],
): boolean {
  const hasParallelOnly = combo.requires.some(
    (requirement) => requirement.constraints?.parallelOnly,
  );

  if (hasParallelOnly) {
    return findAllWithParallelLineConstraint(combo, instances).length > 0;
  }

  if (combo.overlap === 'ALLOW') {
    const pool = buildRequirementPools(combo, instances);
    return pool.every(
      ({ requirement, candidates }) => candidates.length >= requirement.count,
    );
  }

  return solveCombo(combo, instances).isWinner;
}

export function getRelevantCompletedPatterns(
  combo: ComboPattern,
  instances: PatternInstance[],
): PatternInstance[] {
  const seen = new Set<string>();
  const relevantPatterns: PatternInstance[] = [];

  for (const requirement of combo.requires) {
    for (const pattern of filterCandidates(instances, requirement)) {
      if (seen.has(pattern.id)) {
        continue;
      }

      seen.add(pattern.id);
      relevantPatterns.push(pattern);
    }
  }

  return relevantPatterns;
}

export function isLatestNumberInAnyCompletedRelevantPattern(
  combo: ComboPattern,
  instances: PatternInstance[],
  latestCalledNumber: number,
): boolean {
  return getRelevantCompletedPatterns(combo, instances).some((pattern) =>
    pattern.numbers.includes(latestCalledNumber),
  );
}

function patternsAreDisjoint(patterns: PatternInstance[]): boolean {
  for (let leftIndex = 0; leftIndex < patterns.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < patterns.length;
      rightIndex += 1
    ) {
      if (patternCellsOverlap(patterns[leftIndex], patterns[rightIndex])) {
        return false;
      }
    }
  }

  return true;
}

function chooseCombinations(
  candidates: PatternInstance[],
  count: number,
): PatternInstance[][] {
  const results: PatternInstance[][] = [];

  function backtrack(start: number, current: PatternInstance[]): void {
    if (current.length === count) {
      results.push([...current]);
      return;
    }

    for (let index = start; index < candidates.length; index += 1) {
      current.push(candidates[index]);
      backtrack(index + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return results;
}

function selectAllFromPoolAllow(pool: RequirementPool[]): PatternInstance[][] {
  const results: PatternInstance[][] = [];

  function backtrack(poolIndex: number, current: PatternInstance[]): void {
    if (poolIndex >= pool.length) {
      results.push([...current]);
      return;
    }

    const { requirement, candidates } = pool[poolIndex];
    if (candidates.length < requirement.count) {
      return;
    }

    const combinations = chooseCombinations(candidates, requirement.count);
    for (const combination of combinations) {
      current.push(...combination);
      backtrack(poolIndex + 1, current);
      current.splice(current.length - combination.length, combination.length);
    }
  }

  backtrack(0, []);
  return results;
}

function selectAllFromPoolDisallow(
  pool: RequirementPool[],
): PatternInstance[][] {
  const results: PatternInstance[][] = [];
  const selected: PatternInstance[] = [];

  function backtrack(poolIndex: number): void {
    if (poolIndex >= pool.length) {
      results.push([...selected]);
      return;
    }

    const { requirement, candidates } = pool[poolIndex];
    if (candidates.length < requirement.count) {
      return;
    }

    const combinations = chooseCombinations(candidates, requirement.count);

    for (const combination of combinations) {
      if (!patternsAreDisjoint([...selected, ...combination])) {
        continue;
      }

      selected.push(...combination);
      backtrack(poolIndex + 1);
      selected.splice(selected.length - combination.length, combination.length);
    }
  }

  backtrack(0);
  return results;
}

function selectAllFromPoolMixed(pool: RequirementPool[]): PatternInstance[][] {
  const results: PatternInstance[][] = [];
  const selected: PatternInstance[] = [];
  const selectedRequirementByPatternId = new Map<string, ComboRequirement>();

  function violatesMixedOverlap(
    pattern: PatternInstance,
    requirement: ComboRequirement,
  ): boolean {
    const blockedGroups = new Set(requirement.mustNotOverlapGroups ?? []);
    if (blockedGroups.size === 0) {
      return false;
    }

    return selected.some((existing) => {
      const existingRequirement = selectedRequirementByPatternId.get(
        existing.id,
      );
      if (
        !existingRequirement?.group ||
        !blockedGroups.has(existingRequirement.group)
      ) {
        return false;
      }

      return patternCellsOverlap(existing, pattern);
    });
  }

  function violatesContainment(
    pattern: PatternInstance,
    requirement: ComboRequirement,
  ): boolean {
    const blockedGroups = new Set(
      requirement.mustNotBeContainedInGroups ?? [],
    );
    if (blockedGroups.size === 0) {
      return false;
    }

    return selected.some((existing) => {
      const existingRequirement = selectedRequirementByPatternId.get(
        existing.id,
      );
      if (
        !existingRequirement?.group ||
        !blockedGroups.has(existingRequirement.group)
      ) {
        return false;
      }

      return patternContainsPattern(existing, pattern);
    });
  }

  function backtrack(poolIndex: number): void {
    if (poolIndex >= pool.length) {
      results.push([...selected]);
      return;
    }

    const { requirement, candidates } = pool[poolIndex];
    if (candidates.length < requirement.count) {
      return;
    }

    const combinations = chooseCombinations(candidates, requirement.count);

    for (const combination of combinations) {
      const isBlocked = combination.some(
        (pattern) =>
          violatesMixedOverlap(pattern, requirement) ||
          violatesContainment(pattern, requirement),
      );
      if (isBlocked) {
        continue;
      }

      selected.push(...combination);
      combination.forEach((pattern) => {
        selectedRequirementByPatternId.set(pattern.id, requirement);
      });

      backtrack(poolIndex + 1);

      combination.forEach((pattern) => {
        selectedRequirementByPatternId.delete(pattern.id);
      });
      selected.splice(selected.length - combination.length, combination.length);
    }
  }

  backtrack(0);
  return results;
}

function selectAllForOverlap(
  combo: ComboPattern,
  pool: RequirementPool[],
): PatternInstance[][] {
  switch (combo.overlap) {
    case 'ALLOW':
      return selectAllFromPoolAllow(pool);
    case 'DISALLOW':
      return selectAllFromPoolDisallow(pool);
    case 'MIXED':
      return selectAllFromPoolMixed(pool);
    default:
      return [];
  }
}

function findAllWithParallelLineConstraint(
  combo: ComboPattern,
  instances: PatternInstance[],
): PatternInstance[][] {
  const results: PatternInstance[][] = [];
  const directionGroups: Array<'ROW' | 'COLUMN'> = ['ROW', 'COLUMN'];

  for (const directionGroup of directionGroups) {
    const filteredInstances = instances.filter((instance) => {
      if (instance.kind !== 'LINE') {
        return true;
      }

      if (instance.directionGroup === 'DIAGONAL') {
        return false;
      }

      return instance.directionGroup === directionGroup;
    });

    const pool = buildRequirementPools(combo, filteredInstances);
    results.push(...selectAllForOverlap(combo, pool));
  }

  return results;
}

export function findAllWinningCombinations(
  combo: ComboPattern,
  instances: PatternInstance[],
): PatternInstance[][] {
  const hasParallelOnly = combo.requires.some(
    (requirement) => requirement.constraints?.parallelOnly,
  );

  if (hasParallelOnly) {
    return findAllWithParallelLineConstraint(combo, instances);
  }

  const pool = buildRequirementPools(combo, instances);
  return selectAllForOverlap(combo, pool);
}

function pickPreferredCombination(
  combinations: PatternInstance[][],
  preferLatestCalledNumber?: number | null,
): PatternInstance[] | null {
  if (combinations.length === 0) {
    return null;
  }

  if (
    preferLatestCalledNumber !== null &&
    preferLatestCalledNumber !== undefined
  ) {
    const withLatest = combinations.find((combination) =>
      combination.some((pattern) =>
        pattern.numbers.includes(preferLatestCalledNumber),
      ),
    );
    if (withLatest) {
      return withLatest;
    }
  }

  return combinations[0] ?? null;
}

export function solveCombo(
  combo: ComboPattern,
  instances: PatternInstance[],
  options?: SolveComboOptions,
): ComboSolveResult {
  const combinations = findAllWinningCombinations(combo, instances);
  const selectedPatterns = pickPreferredCombination(
    combinations,
    options?.preferLatestCalledNumber,
  );

  if (!selectedPatterns) {
    return { isWinner: false, selectedPatterns: [] };
  }

  return {
    isWinner: true,
    selectedPatterns,
  };
}

export function solveComboWithParallelLineConstraint(
  combo: ComboPattern,
  instances: PatternInstance[],
): ComboSolveResult {
  const combinations = findAllWithParallelLineConstraint(combo, instances);
  const selectedPatterns = combinations[0] ?? null;

  if (!selectedPatterns) {
    return { isWinner: false, selectedPatterns: [] };
  }

  return {
    isWinner: true,
    selectedPatterns,
  };
}

export function computeComboProgress(
  combo: ComboPattern,
  instances: PatternInstance[],
): number {
  if (instances.length === 0) {
    return 0;
  }

  const pool = buildRequirementPools(combo, instances);
  const ratios = pool.map(({ requirement, candidates }) =>
    Math.min(candidates.length / requirement.count, 1),
  );

  if (ratios.length === 0) {
    return 0;
  }

  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

export function isCombinationNewlyCompletedByLatestNumber(
  combination: PatternInstance[],
  latestCalledNumber: number,
  beforeCompletePatternIds: Set<string>,
): boolean {
  const patternsWithLatest = combination.filter((pattern) =>
    pattern.numbers.includes(latestCalledNumber),
  );
  if (patternsWithLatest.length === 0) {
    return false;
  }

  const combinationCompleteBefore = combination.every((pattern) =>
    beforeCompletePatternIds.has(pattern.id),
  );
  if (combinationCompleteBefore) {
    return false;
  }

  return patternsWithLatest.some(
    (pattern) => !beforeCompletePatternIds.has(pattern.id),
  );
}
