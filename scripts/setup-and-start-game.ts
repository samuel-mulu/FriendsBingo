import 'dotenv/config';
import {
  PrismaClient,
  GameStatus,
  GameOperationMode,
  Prisma,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('=== FAST SETUP GAME QUEUE AND OPEN REGISTRATION ===');

  // 1. Cancel all active / ready sessions so we start cleanly
  await prisma.gameSession.updateMany({
    where: {
      status: {
        in: [
          GameStatus.PLAYING,
          GameStatus.WINNER_WINDOW,
          GameStatus.CHECKING,
          GameStatus.READY,
        ],
      },
    },
    data: { status: GameStatus.CANCELLED },
  });
  console.log('Cancelled old active/ready sessions.');

  // 2. Set all slots to AUTO mode in ONE single batch query
  await prisma.gameSlot.updateMany({
    data: {
      status: GameStatus.NEXT,
      operationMode: GameOperationMode.AUTO,
      registrationDurationSeconds: 180,
      autoCallIntervalSeconds: 8,
    },
  });
  console.log('Updated all slots to NEXT and AUTO mode.');

  // 3. Find the first slot
  const firstSlot = await prisma.gameSlot.findFirst({
    where: { status: GameStatus.NEXT },
    orderBy: { sortOrder: 'asc' },
    include: { gameRule: true },
  });

  if (!firstSlot) {
    throw new Error('No slot found in database!');
  }

  // 4. Create READY session for Slot 1 with active registration countdown
  const now = new Date();
  const scheduledStartAt = new Date(Date.now() + 180 * 1000); // 3 minutes countdown
  const playCode = `BINGO-${Math.floor(1000 + Math.random() * 9000)}`;

  const entryFeeNum = Number(firstSlot.entryFee);
  const prizePerCartelaNum = Number(firstSlot.prizePerCartela);
  const companyFeeNum = Math.max(0, entryFeeNum - prizePerCartelaNum);

  const createdSession = await prisma.gameSession.create({
    data: {
      gameSlotId: firstSlot.id,
      playCode,
      status: GameStatus.READY,
      entryFee: firstSlot.entryFee,
      prizePerCartela: firstSlot.prizePerCartela,
      companyFeePerCartela: new Prisma.Decimal(companyFeeNum),
      registrationOpensAt: now,
      scheduledStartAt: scheduledStartAt,
    },
  });

  console.log(`\n======================================================`);
  console.log(`>>> GAME REGISTRATION IS NOW OPEN ON DASHBOARD! <<<`);
  console.log(`Session ID: ${createdSession.id}`);
  console.log(`Play Code: ${createdSession.playCode}`);
  console.log(
    `Slot: ${firstSlot.staticCode} (${firstSlot.gameRule?.name ?? 'Standard Game'})`,
  );
  console.log(`Status: ${createdSession.status}`);
  console.log(
    `Registration Countdown Ends: ${scheduledStartAt.toLocaleTimeString()}`,
  );
  console.log(`======================================================`);
}

main()
  .catch((e) => {
    console.error('Failed to setup and start game:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
