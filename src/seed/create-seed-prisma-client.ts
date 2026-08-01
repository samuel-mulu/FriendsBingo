import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function createSeedPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database seeds');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  return new PrismaClient({ adapter });
}
