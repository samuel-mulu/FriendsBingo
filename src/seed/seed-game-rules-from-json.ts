import * as fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';

import { cleanupLegacyGameRules } from '../game-rules/game-rule-legacy-cleanup';
import { createSeedPrismaClient } from './create-seed-prisma-client';
import { resolveGameRuleSeedPath } from './seed-data-paths';

type ExportedGameRule = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  sortOrder: number;
  patterns?: Prisma.InputJsonValue | null;
};

function loadGameRulesFromJson(filePath = resolveGameRuleSeedPath()) {
  const rules = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExportedGameRule[];

  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error(`Game rule seed file is empty: ${filePath}`);
  }

  return { filePath, rules };
}

export async function seedGameRulesFromJson(prisma: PrismaClient) {
  const { filePath, rules } = loadGameRulesFromJson();

  console.log(`Loading ${rules.length} game rules from ${filePath}`);

  for (const rule of rules) {
    await prisma.gameRule.upsert({
      where: { key: rule.key },
      update: {
        name: rule.name,
        description: rule.description ?? null,
        isActive: rule.isActive,
        sortOrder: rule.sortOrder,
        patterns: rule.patterns ?? Prisma.JsonNull,
      },
      create: {
        id: rule.id,
        key: rule.key,
        name: rule.name,
        description: rule.description ?? null,
        isActive: rule.isActive,
        sortOrder: rule.sortOrder,
        patterns: rule.patterns ?? Prisma.JsonNull,
      },
    });
  }

  const cleanup = await cleanupLegacyGameRules(prisma);

  return {
    seededCount: rules.length,
    deletedLegacyCount: cleanup.deletedCount,
    deactivatedLegacyCount: cleanup.deactivatedCount,
  };
}

export async function runGameRuleSeedFromJson() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedGameRulesFromJson(prisma);
    console.log(`Seeded ${summary.seededCount} game rules from JSON export`);
    console.log(`Deleted ${summary.deletedLegacyCount} unreferenced legacy rules`);
    console.log(
      `Deactivated ${summary.deactivatedLegacyCount} referenced legacy rules`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
