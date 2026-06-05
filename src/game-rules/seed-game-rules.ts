import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seededGameRules } from './game-rule.seed-data';

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
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${seededGameRules.length} game rules`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
