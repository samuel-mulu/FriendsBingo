#!/usr/bin/env ts-node

/**
 * Repair Invalid READY Sessions Script
 * 
 * Finds and repairs READY sessions with invalid/missing slots.
 * Safe to run in production. Idempotent.
 * 
 * Usage:
 *   npm run repair:invalid-ready-sessions          # Dry run (shows what would be repaired)
 *   npm run repair:invalid-ready-sessions -- --fix  # Actually repair
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GameOperationRepairService } from '../src/games/game-operation-repair.service';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--fix');

  console.log('='.repeat(60));
  console.log('Repair Invalid READY Sessions');
  console.log('='.repeat(60));
  console.log();

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Run with --fix to actually repair sessions');
    console.log();
  } else {
    console.log('⚠️  FIX MODE - Will repair invalid sessions');
    console.log();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const repairService = app.get(GameOperationRepairService);

  try {
    const result = await repairService.repairAllInvalidReadySessions(dryRun);

    console.log();
    console.log('='.repeat(60));
    console.log('Repair Summary');
    console.log('='.repeat(60));
    console.log(`Found:                 ${result.found}`);
    console.log(`Repaired:              ${result.repaired}`);
    console.log(`  With registrations:  ${result.withRegistrations}`);
    console.log(`  Without registrations: ${result.withoutRegistrations}`);
    console.log();

    if (dryRun && result.found > 0) {
      console.log('💡 Run with --fix to repair these sessions');
    } else if (!dryRun && result.repaired > 0) {
      console.log('✅ Repair complete');
    } else if (result.found === 0) {
      console.log('✅ No invalid READY sessions found');
    }

    console.log();
  } catch (error) {
    console.error('❌ Repair failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
