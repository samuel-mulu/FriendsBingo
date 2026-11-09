import { PrismaClient } from '@prisma/client';

import {
  APP_VERSION_CONFIG_ID,
  DEFAULT_APP_VERSION_RELEASE_NOTES,
} from '../app-version-config/app-version-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export async function seedAppVersionConfig(prisma: PrismaClient) {
  const envReleaseNotes = process.env.ANDROID_RELEASE_NOTES?.trim();

  await prisma.appVersionConfig.upsert({
    where: { id: APP_VERSION_CONFIG_ID },
    update: {},
    create: {
      id: APP_VERSION_CONFIG_ID,
      releaseNotes: envReleaseNotes || DEFAULT_APP_VERSION_RELEASE_NOTES,
    },
  });

  return {
    id: APP_VERSION_CONFIG_ID,
  };
}

export async function runAppVersionConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedAppVersionConfig(prisma);
    console.log(`Seeded app version config id=${summary.id}`);
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
