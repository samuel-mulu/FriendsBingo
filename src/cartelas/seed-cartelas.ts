import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed cartelas');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    // Read the cartelas JSON file
    const cartelasPath = path.join(__dirname, 'cartelas.json');
    const cartelas = JSON.parse(fs.readFileSync(cartelasPath, 'utf-8'));

    let seededCount = 0;

    // Process each cartela
    for (const [number, data] of Object.entries(cartelas)) {
      const cartelaNumber = parseInt(number);

      await prisma.cartela.upsert({
        where: { number: cartelaNumber },
        update: {
          b: (data as any).B,
          i: (data as any).I,
          n: (data as any).N,
          g: (data as any).G,
          o: (data as any).O,
        },
        create: {
          number: cartelaNumber,
          b: (data as any).B,
          i: (data as any).I,
          n: (data as any).N,
          g: (data as any).G,
          o: (data as any).O,
        },
      });

      seededCount++;

      // Log progress every 100 cartelas
      if (seededCount % 100 === 0) {
        console.log(`Seeded ${seededCount} cartelas...`);
      }
    }

    console.log(`✅ Successfully seeded ${seededCount} cartelas!`);
  } catch (error) {
    console.error('Error seeding cartelas:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
