import { PrismaClient } from '@prisma/client';

import { FINAL_PRODUCT_RULE_KEYS } from './patterns/game-rule.patterns';

export interface LegacyGameRuleCleanupResult {
  deletedCount: number;
  deactivatedCount: number;
}

export async function cleanupLegacyGameRules(
  prisma: PrismaClient,
): Promise<LegacyGameRuleCleanupResult> {
  const finalKeys = new Set<string>(FINAL_PRODUCT_RULE_KEYS);
  let deletedCount = 0;
  let deactivatedCount = 0;

  const existingRules = await prisma.gameRule.findMany({
    select: { id: true, key: true, name: true },
  });

  for (const rule of existingRules) {
    if (finalKeys.has(rule.key)) {
      continue;
    }

    const slotCount = await prisma.gameSlot.count({
      where: { gameRuleId: rule.id },
    });

    if (slotCount === 0) {
      await prisma.gameRule.delete({ where: { id: rule.id } });
      deletedCount += 1;
      continue;
    }

    const legacyName = rule.name.startsWith('Legacy - ')
      ? rule.name
      : `Legacy - ${rule.name}`;

    await prisma.gameRule.update({
      where: { id: rule.id },
      data: {
        isActive: false,
        name: legacyName,
      },
    });
    deactivatedCount += 1;
  }

  return { deletedCount, deactivatedCount };
}
