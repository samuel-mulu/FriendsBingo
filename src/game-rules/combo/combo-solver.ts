import {
  ComboPattern,
  ComboRequirement,
  ComboSolveResult,
  PatternConstraints,
  PatternInstance,
} from './combo.types';
import { patternCellsOverlap } from './base-pattern-generator';

interface RequirementPool {
  requirement: ComboRequirement;
  candidates: PatternInstance[];
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

function filterCandidates(
  instances: PatternInstance[],
  requirement: ComboRequirement,
): PatternInstance[] {
  return instances.filter(
    (instance) =>
      instance.kind === requirement.kind &&
      matchesConstraints(instance, requirement.constraints),
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

function selectFromPoolAllow(
  pool: RequirementPool[],
): PatternInstance[] | null {
  const selected: PatternInstance[] = [];

  for (const { requirement, candidates } of pool) {
    if (candidates.length < requirement.count) {
      return null;
    }

    selected.push(...candidates.slice(0, requirement.count));
  }

  return selected;
}

function selectFromPoolDisallow(
  pool: RequirementPool[],
): PatternInstance[] | null {
  const selected: PatternInstance[] = [];

  function backtrack(poolIndex: number): boolean {
    if (poolIndex >= pool.length) {
      return true;
    }

    const { requirement, candidates } = pool[poolIndex];
    if (candidates.length < requirement.count) {
      return false;
    }

    const combinations = chooseCombinations(candidates, requirement.count);

    for (const combination of combinations) {
      if (!patternsAreDisjoint([...selected, ...combination])) {
        continue;
      }

      selected.push(...combination);
      if (backtrack(poolIndex + 1)) {
        return true;
      }

      selected.splice(selected.length - combination.length, combination.length);
    }

    return false;
  }

  return backtrack(0) ? selected : null;
}

function selectFromPoolMixed(
  pool: RequirementPool[],
): PatternInstance[] | null {
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
      const existingRequirement = selectedRequirementByPatternId.get(existing.id);
      if (
        !existingRequirement?.group ||
        !blockedGroups.has(existingRequirement.group)
      ) {
        return false;
      }

      return patternCellsOverlap(existing, pattern);
    });
  }

  function backtrack(poolIndex: number): boolean {
    if (poolIndex >= pool.length) {
      return true;
    }

    const { requirement, candidates } = pool[poolIndex];
    if (candidates.length < requirement.count) {
      return false;
    }

    const combinations = chooseCombinations(candidates, requirement.count);

    for (const combination of combinations) {
      const hasOverlap = combination.some((pattern) =>
        violatesMixedOverlap(pattern, requirement),
      );
      if (hasOverlap) {
        continue;
      }

      selected.push(...combination);
      combination.forEach((pattern) => {
        selectedRequirementByPatternId.set(pattern.id, requirement);
      });

      if (backtrack(poolIndex + 1)) {
        return true;
      }

      combination.forEach((pattern) => {
        selectedRequirementByPatternId.delete(pattern.id);
      });
      selected.splice(selected.length - combination.length, combination.length);
    }

    return false;
  }

  return backtrack(0) ? selected : null;
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

export function solveCombo(
  combo: ComboPattern,
  instances: PatternInstance[],
): ComboSolveResult {
  const hasParallelOnly = combo.requires.some(
    (requirement) => requirement.constraints?.parallelOnly,
  );

  if (hasParallelOnly) {
    return solveComboWithParallelLineConstraint(combo, instances);
  }

  const pool = buildRequirementPools(combo, instances);

  let selectedPatterns: PatternInstance[] | null = null;

  switch (combo.overlap) {
    case 'ALLOW':
      selectedPatterns = selectFromPoolAllow(pool);
      break;
    case 'DISALLOW':
      selectedPatterns = selectFromPoolDisallow(pool);
      break;
    case 'MIXED':
      selectedPatterns = selectFromPoolMixed(pool);
      break;
    default:
      selectedPatterns = null;
  }

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
    const result =
      combo.overlap === 'DISALLOW'
        ? selectFromPoolDisallow(pool)
        : combo.overlap === 'MIXED'
          ? selectFromPoolMixed(pool)
          : selectFromPoolAllow(pool);

    if (result) {
      return { isWinner: true, selectedPatterns: result };
    }
  }

  return { isWinner: false, selectedPatterns: [] };
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
