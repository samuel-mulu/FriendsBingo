import { PrismaClient } from '@prisma/client';

import {
  APP_DISPLAY_CONFIG_ID,
  DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED,
  DEFAULT_WINNER_PHONE_DISPLAY_MODE,
} from '../app-display-config/app-display-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export async function seedAppDisplayConfig(prisma: PrismaClient) {
  await prisma.appDisplayConfig.upsert({
    where: { id: APP_DISPLAY_CONFIG_ID },
    update: {},
    create: {
      id: APP_DISPLAY_CONFIG_ID,
      winnerPhoneDisplayMode: DEFAULT_WINNER_PHONE_DISPLAY_MODE,
      bigGamePromotionCardEnabled: DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED,
    },
  });

  return {
    id: APP_DISPLAY_CONFIG_ID,
    winnerPhoneDisplayMode: DEFAULT_WINNER_PHONE_DISPLAY_MODE,
    bigGamePromotionCardEnabled: DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED,
  };
}

export async function runAppDisplayConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedAppDisplayConfig(prisma);
    console.log(
      `Seeded app display config id=${summary.id} winnerPhoneDisplayMode=${summary.winnerPhoneDisplayMode}`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
