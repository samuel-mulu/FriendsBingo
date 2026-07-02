import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

type CartelaSeedRow = {
  B: Array<number | string>;
  I: Array<number | string>;
  N: Array<number | string>;
  G: Array<number | string>;
  O: Array<number | string>;
};

const BATCH_SIZE = 50;

function resolveCartelasPath(): string {
  const candidates = [
    path.join(__dirname, 'cartelas.json'),
    path.join(process.cwd(), 'src/cartelas/cartelas.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'cartelas.json not found. Expected src/cartelas/cartelas.json',
  );
}

function toBoardColumn(values: Array<number | string>): Prisma.InputJsonValue {
  return values.map((value) => value.toString());
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed cartelas');
  }

  const cartelasPath = resolveCartelasPath();
  const cartelas = JSON.parse(
    fs.readFileSync(cartelasPath, 'utf-8'),
  ) as Record<string, CartelaSeedRow>;
  const entries = Object.entries(cartelas);

  console.log(`Loading ${entries.length} cartelas from ${cartelasPath}`);

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    let seededCount = 0;

    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      const batch = entries.slice(offset, offset + BATCH_SIZE);

      await Promise.all(
        batch.map(([number, data]) => {
          const cartelaNumber = Number.parseInt(number, 10);

          return prisma.cartela.upsert({
            where: { number: cartelaNumber },
            update: {
              b: toBoardColumn(data.B),
              i: toBoardColumn(data.I),
              n: toBoardColumn(data.N),
              g: toBoardColumn(data.G),
              o: toBoardColumn(data.O),
            },
            create: {
              number: cartelaNumber,
              b: toBoardColumn(data.B),
              i: toBoardColumn(data.I),
              n: toBoardColumn(data.N),
              g: toBoardColumn(data.G),
              o: toBoardColumn(data.O),
            },
          });
        }),
      );

      seededCount += batch.length;

      if (seededCount % 500 === 0 || seededCount === entries.length) {
        console.log(`Seeded ${seededCount}/${entries.length} cartelas...`);
      }
    }

    const totalInDb = await prisma.cartela.count();
    console.log(`Successfully seeded ${seededCount} cartelas from file.`);
    console.log(`Cartela rows in database: ${totalInDb}`);
  } catch (error) {
    console.error('Error seeding cartelas:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
