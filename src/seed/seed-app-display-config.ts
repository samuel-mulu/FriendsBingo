import { PrismaClient } from '@prisma/client';

import {
  APP_DISPLAY_CONFIG_ID,
  DEFAULT_SHOW_WINNER_PHONE_NUMBER,
} from '../app-display-config/app-display-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export async function seedAppDisplayConfig(prisma: PrismaClient) {
  await prisma.appDisplayConfig.upsert({
    where: { id: APP_DISPLAY_CONFIG_ID },
    update: {},
    create: {
      id: APP_DISPLAY_CONFIG_ID,
      showWinnerPhoneNumber: DEFAULT_SHOW_WINNER_PHONE_NUMBER,
    },
  });

  return {
    id: APP_DISPLAY_CONFIG_ID,
    showWinnerPhoneNumber: DEFAULT_SHOW_WINNER_PHONE_NUMBER,
  };
}

export async function runAppDisplayConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedAppDisplayConfig(prisma);
    console.log(
      `Seeded app display config id=${summary.id} showWinnerPhoneNumber=${summary.showWinnerPhoneNumber}`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
