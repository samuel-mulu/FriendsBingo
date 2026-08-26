import { createSeedPrismaClient } from './create-seed-prisma-client';
import { seedAppDisplayConfig } from './seed-app-display-config';
import { seedCartelas } from './seed-cartelas';
import { seedGameRulesFromJson } from './seed-game-rules-from-json';
import { seedGameTimingConfig } from './seed-game-timing-config';
import { seedNotificationConfig } from './seed-notification-config';

async function main() {
  const prisma = createSeedPrismaClient();

  try {
    console.log('Starting production seed...');

    const timing = await seedGameTimingConfig(prisma);
    console.log(
      `Game timing config ready id=${timing.id} updatedById=${timing.updatedById ?? 'none'}`,
    );

    const display = await seedAppDisplayConfig(prisma);
    console.log(
      `App display config ready id=${display.id} winnerPhoneDisplayMode=${display.winnerPhoneDisplayMode}`,
    );

    const notification = await seedNotificationConfig(prisma);
    console.log(
      `Notification config ready id=${notification.id} pushNotificationsEnabled=${notification.pushNotificationsEnabled}`,
    );

    const rules = await seedGameRulesFromJson(prisma);
    console.log(
      `Game rules ready count=${rules.seededCount} deletedLegacy=${rules.deletedLegacyCount} deactivatedLegacy=${rules.deactivatedLegacyCount}`,
    );

    const cartelas = await seedCartelas(prisma);
    console.log(
      `Cartelas ready seeded=${cartelas.seededCount} excluded=${cartelas.excludedCount} dbTotal=${cartelas.totalInDb}`,
    );

    console.log('Production seed completed successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Production seed failed:', error);
  process.exitCode = 1;
});
