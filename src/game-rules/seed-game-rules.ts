import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { FINAL_PRODUCT_RULE_KEYS } from './patterns/game-rule.patterns';
import { seededGameRules } from './game-rule.seed-data';

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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed game rules');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    for (const rule of seededGameRules) {
      await prisma.gameRule.upsert({
        where: { key: rule.key },
        update: {
          name: rule.name,
          description: rule.description ?? null,
          isActive: rule.isActive,
          sortOrder: rule.sortOrder,
          patterns: rule.patterns,
        },
        create: {
          key: rule.key,
          name: rule.name,
          description: rule.description ?? null,
          isActive: rule.isActive,
          sortOrder: rule.sortOrder,
          patterns: rule.patterns,
        },
      });
    }

    const cleanup = await cleanupLegacyGameRules(prisma);

    console.log(`Seeded ${seededGameRules.length} active product game rules`);
    console.log(`Deleted ${cleanup.deletedCount} unreferenced legacy game rules`);
    console.log(
      `Deactivated ${cleanup.deactivatedCount} referenced legacy game rules`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
