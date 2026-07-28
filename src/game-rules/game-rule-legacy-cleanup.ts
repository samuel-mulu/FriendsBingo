import { PrismaClient } from '@prisma/client';

import { LEGACY_GAME_RULE_KEYS } from './game-rule.seed-data';

export interface LegacyGameRuleCleanupResult {
  deletedCount: number;
  deactivatedCount: number;
}

/**
 * Additive-safe cleanup: only touches keys explicitly listed as legacy-removed.
 * Never deletes arbitrary keys that are simply absent from the product catalog.
 */
export async function cleanupLegacyGameRules(
  prisma: PrismaClient,
): Promise<LegacyGameRuleCleanupResult> {
  const legacyKeys = new Set<string>(LEGACY_GAME_RULE_KEYS);
  let deletedCount = 0;
  let deactivatedCount = 0;

  const existingRules = await prisma.gameRule.findMany({
    select: { id: true, key: true, name: true },
  });

  for (const rule of existingRules) {
    if (!legacyKeys.has(rule.key)) {
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
