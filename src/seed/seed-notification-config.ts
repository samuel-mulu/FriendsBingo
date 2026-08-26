import { PrismaClient } from '@prisma/client';

import {
  DEFAULT_PUSH_NOTIFICATIONS_ENABLED,
  NOTIFICATION_CONFIG_ID,
} from '../notification-config/notification-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export async function seedNotificationConfig(prisma: PrismaClient) {
  await prisma.notificationConfig.upsert({
    where: { id: NOTIFICATION_CONFIG_ID },
    update: {},
    create: {
      id: NOTIFICATION_CONFIG_ID,
      pushNotificationsEnabled: DEFAULT_PUSH_NOTIFICATIONS_ENABLED,
    },
  });

  return {
    id: NOTIFICATION_CONFIG_ID,
    pushNotificationsEnabled: DEFAULT_PUSH_NOTIFICATIONS_ENABLED,
  };
}

export async function runNotificationConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedNotificationConfig(prisma);
    console.log(
      `Seeded notification config id=${summary.id} pushNotificationsEnabled=${summary.pushNotificationsEnabled}`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
