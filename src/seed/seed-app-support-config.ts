import { PrismaClient } from '@prisma/client';

import {
  APP_SUPPORT_CONFIG_ID,
  DEFAULT_SUPPORT_PHONE_NUMBER_1,
  DEFAULT_SUPPORT_PHONE_NUMBER_2,
  DEFAULT_SUPPORT_TELEGRAM_USERNAME,
  DEFAULT_SUPPORT_TERMS_BODY,
} from '../app-support-config/app-support-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export async function seedAppSupportConfig(prisma: PrismaClient) {
  await prisma.appSupportConfig.upsert({
    where: { id: APP_SUPPORT_CONFIG_ID },
    update: {},
    create: {
      id: APP_SUPPORT_CONFIG_ID,
      phoneNumber1: DEFAULT_SUPPORT_PHONE_NUMBER_1,
      phoneNumber2: DEFAULT_SUPPORT_PHONE_NUMBER_2,
      telegramUsername: DEFAULT_SUPPORT_TELEGRAM_USERNAME,
      termsBody: DEFAULT_SUPPORT_TERMS_BODY,
    },
  });

  return {
    id: APP_SUPPORT_CONFIG_ID,
    phoneNumber1: DEFAULT_SUPPORT_PHONE_NUMBER_1,
    phoneNumber2: DEFAULT_SUPPORT_PHONE_NUMBER_2,
    telegramUsername: DEFAULT_SUPPORT_TELEGRAM_USERNAME,
  };
}

export async function runAppSupportConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedAppSupportConfig(prisma);
    console.log(
      `Seeded app support config id=${summary.id} telegram=${summary.telegramUsername}`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
