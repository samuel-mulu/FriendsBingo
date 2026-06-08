/**
 * Lightweight load probe for winner-window open races.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register scripts/load-test-concurrent-claims.ts
 *
 * Requires DATABASE_URL and a prepared PLAYING session with registered cartelas.
 * This script is intentionally opt-in because it mutates real data.
 */

import { PrismaClient, GameStatus } from '@prisma/client';

const prisma = new PrismaClient();
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY ?? 10);
const SESSION_ID = process.env.LOAD_TEST_SESSION_ID;

async function main() {
  if (!SESSION_ID) {
    throw new Error('Set LOAD_TEST_SESSION_ID to a PLAYING session id.');
  }

  const session = await prisma.gameSession.findUnique({
    where: { id: SESSION_ID },
    select: {
      id: true,
      status: true,
      winnerWindowEndsAt: true,
      winnerWindowStartedAt: true,
      gameCartelas: {
        where: { status: 'REGISTERED' },
        take: CONCURRENCY,
        select: { id: true, userId: true },
      },
    },
  });

  if (!session) {
    throw new Error(`Session ${SESSION_ID} not found`);
  }

  console.log(
    `[load-test] session=${session.id} status=${session.status} cartelas=${session.gameCartelas.length}`,
  );

  const startedAt = Date.now();
  const results = await Promise.allSettled(
    session.gameCartelas.map(async (cartela, index) => {
      const openResult = await prisma.gameSession.updateMany({
        where: {
          id: session.id,
          status: GameStatus.PLAYING,
        },
        data: {
          status: GameStatus.WINNER_WINDOW,
          winnerWindowStartedAt: new Date(),
          winnerWindowEndsAt: new Date(Date.now() + 15_000),
          autoCallEnabled: false,
          nextAutoCallAt: null,
        },
      });

      return {
        index,
        cartelaId: cartela.id,
        opened: openResult.count === 1,
      };
    }),
  );

  const refreshed = await prisma.gameSession.findUnique({
    where: { id: SESSION_ID },
    select: {
      status: true,
      winnerWindowStartedAt: true,
      winnerWindowEndsAt: true,
    },
  });

  const openedCount = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => (result as PromiseFulfilledResult<{ opened: boolean }>).value)
    .filter((value) => value.opened).length;

  console.log(
    JSON.stringify(
      {
        durationMs: Date.now() - startedAt,
        concurrency: CONCURRENCY,
        openedCount,
        session: refreshed,
      },
      null,
      2,
    ),
  );

  if (openedCount !== 1) {
    console.error(
      `[load-test] expected exactly one winner-window open, got ${openedCount}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[load-test] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
