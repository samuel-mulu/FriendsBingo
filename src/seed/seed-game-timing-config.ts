import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

import { GAME_TIMING_CONFIG_ID } from '../game-timing-config/game-timing-config.defaults';
import { createSeedPrismaClient } from './create-seed-prisma-client';
import { resolveGameTimingConfigSeedPath } from './seed-data-paths';

type ExportedGameTimingConfig = {
  id: string;
  registrationDurationSeconds: number;
  autoCallIntervalSeconds: number;
  winnerWindowSeconds: number;
  winnerWindowClaimGraceMs: number;
  cartelaHoldSeconds: number;
  bulkSelectionHoldSeconds: number;
  finishedResultDisplaySeconds: number;
  winningPatternDisplaySeconds: number;
  preparingDisplayMaxSeconds: number | null;
  missedNumberAnimationMs: number;
  missedNumberStaggerMaxBalls: number;
  adminRefreshDebounceMs: number;
  adminFallbackPollingSeconds: number;
  flutterRefetchDebounceMs: number;
  updatedById?: string | null;
};

function loadGameTimingConfigFromJson(
  filePath = resolveGameTimingConfigSeedPath(),
) {
  const rows = JSON.parse(
    fs.readFileSync(filePath, 'utf-8'),
  ) as ExportedGameTimingConfig[];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Game timing config seed file is empty: ${filePath}`);
  }

  const config = rows.find((row) => row.id === GAME_TIMING_CONFIG_ID) ?? rows[0];
  return { filePath, config };
}

async function resolveUpdatedById(
  prisma: PrismaClient,
  updatedById?: string | null,
) {
  if (!updatedById) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: updatedById },
    select: { id: true },
  });

  return user?.id ?? null;
}

export async function seedGameTimingConfig(prisma: PrismaClient) {
  const { filePath, config } = loadGameTimingConfigFromJson();
  const updatedById = await resolveUpdatedById(prisma, config.updatedById);

  console.log(`Loading game timing config from ${filePath}`);

  await prisma.gameTimingConfig.upsert({
    where: { id: GAME_TIMING_CONFIG_ID },
    update: {
      registrationDurationSeconds: config.registrationDurationSeconds,
      autoCallIntervalSeconds: config.autoCallIntervalSeconds,
      winnerWindowSeconds: config.winnerWindowSeconds,
      winnerWindowClaimGraceMs: config.winnerWindowClaimGraceMs,
      cartelaHoldSeconds: config.cartelaHoldSeconds,
      bulkSelectionHoldSeconds: config.bulkSelectionHoldSeconds,
      finishedResultDisplaySeconds: config.finishedResultDisplaySeconds,
      winningPatternDisplaySeconds: config.winningPatternDisplaySeconds,
      preparingDisplayMaxSeconds: config.preparingDisplayMaxSeconds,
      missedNumberAnimationMs: config.missedNumberAnimationMs,
      missedNumberStaggerMaxBalls: config.missedNumberStaggerMaxBalls,
      adminRefreshDebounceMs: config.adminRefreshDebounceMs,
      adminFallbackPollingSeconds: config.adminFallbackPollingSeconds,
      flutterRefetchDebounceMs: config.flutterRefetchDebounceMs,
      updatedById,
    },
    create: {
      id: GAME_TIMING_CONFIG_ID,
      registrationDurationSeconds: config.registrationDurationSeconds,
      autoCallIntervalSeconds: config.autoCallIntervalSeconds,
      winnerWindowSeconds: config.winnerWindowSeconds,
      winnerWindowClaimGraceMs: config.winnerWindowClaimGraceMs,
      cartelaHoldSeconds: config.cartelaHoldSeconds,
      bulkSelectionHoldSeconds: config.bulkSelectionHoldSeconds,
      finishedResultDisplaySeconds: config.finishedResultDisplaySeconds,
      winningPatternDisplaySeconds: config.winningPatternDisplaySeconds,
      preparingDisplayMaxSeconds: config.preparingDisplayMaxSeconds,
      missedNumberAnimationMs: config.missedNumberAnimationMs,
      missedNumberStaggerMaxBalls: config.missedNumberStaggerMaxBalls,
      adminRefreshDebounceMs: config.adminRefreshDebounceMs,
      adminFallbackPollingSeconds: config.adminFallbackPollingSeconds,
      flutterRefetchDebounceMs: config.flutterRefetchDebounceMs,
      updatedById,
    },
  });

  return {
    id: GAME_TIMING_CONFIG_ID,
    updatedById,
  };
}

export async function runGameTimingConfigSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const summary = await seedGameTimingConfig(prisma);
    console.log(
      `Seeded game timing config id=${summary.id} updatedById=${summary.updatedById ?? 'none'}`,
    );
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
