import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { GameOperationMode, GameStatus, PrismaClient } from '@prisma/client';
import {
  DEFAULT_REGISTRATION_DURATION_SECONDS,
  GAME_TIMING_CONFIG_ID,
} from '../src/game-timing-config/game-timing-config.defaults';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to repair AUTO READY countdowns');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const timingConfig = await prisma.gameTimingConfig.findUnique({
      where: { id: GAME_TIMING_CONFIG_ID },
      select: { registrationDurationSeconds: true },
    });
    const registrationDurationSeconds =
      timingConfig?.registrationDurationSeconds ??
      DEFAULT_REGISTRATION_DURATION_SECONDS;
    const scheduledStartAt = new Date(
      Date.now() + registrationDurationSeconds * 1000,
    );

    const result = await prisma.gameSession.updateMany({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      data: { scheduledStartAt },
    });

    console.log(
      `Repaired ${result.count} AUTO READY session countdown${result.count === 1 ? '' : 's'} with scheduledStartAt=${scheduledStartAt.toISOString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to repair AUTO READY countdowns', error);
  process.exitCode = 1;
});
