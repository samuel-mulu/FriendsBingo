import { Prisma, PrismaClient } from '@prisma/client';

import { createSeedPrismaClient } from './create-seed-prisma-client';
import { loadCartelaSeedEntries } from './cartela-seed-loader';

const BATCH_SIZE = 50;

function toBoardColumn(values: Array<number | string>): Prisma.InputJsonValue {
  return values.map((value) => value.toString());
}

export async function seedCartelas(prisma: PrismaClient) {
  const { filePath, totalInFile, excludedCount, entries } =
    loadCartelaSeedEntries();

  console.log(
    `Loading cartelas from ${filePath} (${totalInFile} in file, ${excludedCount} excluded, ${entries.length} to seed)`,
  );

  let seededCount = 0;

  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    const batch = entries.slice(offset, offset + BATCH_SIZE);

    await Promise.all(
      batch.map(({ number, board }) =>
        prisma.cartela.upsert({
          where: { number },
          update: {
            b: toBoardColumn(board.B),
            i: toBoardColumn(board.I),
            n: toBoardColumn(board.N),
            g: toBoardColumn(board.G),
            o: toBoardColumn(board.O),
          },
          create: {
            number,
            b: toBoardColumn(board.B),
            i: toBoardColumn(board.I),
            n: toBoardColumn(board.N),
            g: toBoardColumn(board.G),
            o: toBoardColumn(board.O),
          },
        }),
      ),
    );

    seededCount += batch.length;

    if (seededCount % 500 === 0 || seededCount === entries.length) {
      console.log(`Seeded ${seededCount}/${entries.length} cartelas...`);
    }
  }

  const totalInDb = await prisma.cartela.count();

  return {
    seededCount,
    excludedCount,
    totalInFile,
    totalInDb,
  };
}

export async function runCartelaSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedCartelas(prisma);
    console.log(`Successfully seeded ${summary.seededCount} cartelas.`);
    console.log(`Excluded ${summary.excludedCount} cartelas by number range.`);
    console.log(`Cartela rows in database: ${summary.totalInDb}`);
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
