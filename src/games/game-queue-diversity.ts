import { BadRequestException } from '@nestjs/common';

export const QUEUE_RULE_DIVERSITY_WINDOW = 5;

export const QUEUE_RULE_DIVERSITY_MESSAGE =
  'First 5 queue games must use different rules.';

export type QueueOrderingSlot = {
  id: string;
  gameRuleId: string | null;
  sortOrder: number | null;
};

export function assertTopFiveQueueRuleDiversity(
  gameRuleIds: ReadonlyArray<string | null | undefined>,
): void {
  const topFive = gameRuleIds.slice(0, QUEUE_RULE_DIVERSITY_WINDOW);
  const seen = new Set<string>();

  for (const ruleId of topFive) {
    if (!ruleId) {
      continue;
    }

    if (seen.has(ruleId)) {
      throw new BadRequestException(QUEUE_RULE_DIVERSITY_MESSAGE);
    }

    seen.add(ruleId);
  }
}

export function shouldDeferDuplicateRuleInTopFive(
  queueSlots: ReadonlyArray<Pick<QueueOrderingSlot, 'gameRuleId'>>,
  gameRuleId: string,
): boolean {
  const topFive = queueSlots.slice(0, QUEUE_RULE_DIVERSITY_WINDOW);
  return topFive.some((slot) => slot.gameRuleId === gameRuleId);
}

export function resolveInsertAfterSortOrder(
  queueSlots: ReadonlyArray<Pick<QueueOrderingSlot, 'sortOrder'>>,
): number {
  if (queueSlots.length === 0) {
    return 0;
  }

  const anchorIndex = Math.min(
    QUEUE_RULE_DIVERSITY_WINDOW - 1,
    queueSlots.length - 1,
  );

  return queueSlots[anchorIndex]?.sortOrder ?? anchorIndex + 1;
}
