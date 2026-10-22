import 'dotenv/config';
import {
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
  WalletTransactionType,
  PaymentProvider,
  DepositStatus,
  GameStatus,
  GameCategory,
  GameOperationMode,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  ethiopianPhoneLookupVariants,
  normalizeEthiopianPhone,
} from '../src/common/utils/phone.util';
import { createSeedPrismaClient } from '../src/seed/create-seed-prisma-client';
import { seedCartelas } from '../src/seed/seed-cartelas';

export interface DemoPlayerConfig {
  phoneNumber: string;
  fullName: string;
  password: string;
  depositAmount: number;
}

export const DEMO_PLAYERS: DemoPlayerConfig[] = [
  {
    phoneNumber: '0912000001',
    fullName: 'Demo Player 1',
    password: 'Password123!',
    depositAmount: 100,
  },
  {
    phoneNumber: '0912000002',
    fullName: 'Demo Player 2',
    password: 'Password123!',
    depositAmount: 100,
  },
  {
    phoneNumber: '0912000003',
    fullName: 'Demo Player 3',
    password: 'Password123!',
    depositAmount: 100,
  },
];

function generatePlayCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BINGO-${code}`;
}

async function seedDemoUser(prisma: PrismaClient, config: DemoPlayerConfig) {
  const normalizedPhone = normalizeEthiopianPhone(config.phoneNumber);
  const passwordHash = await bcrypt.hash(config.password, 10);

  const existing = await prisma.user.findFirst({
    where: {
      OR: ethiopianPhoneLookupVariants(normalizedPhone).map((variant) => ({
        phoneNumber: variant,
      })),
    },
    include: { wallet: true },
  });

  const depositDecimal = new Prisma.Decimal(config.depositAmount);

  let userId: string;

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: config.fullName,
        phoneNumber: normalizedPhone,
        password: passwordHash,
        role: UserRole.PLAYER,
        status: UserStatus.ACTIVE,
        autoMarkGranted: true,
        autoMarkEnabled: true,
        autoBingoGranted: true,
        autoBingoEnabled: true,
      },
    });
    userId = updated.id;

    if (existing.wallet) {
      await prisma.wallet.update({
        where: { id: existing.wallet.id },
        data: {
          balance: depositDecimal,
          lockedBalance: new Prisma.Decimal(0),
        },
      });
    } else {
      await prisma.wallet.create({
        data: {
          userId: existing.id,
          balance: depositDecimal,
          lockedBalance: new Prisma.Decimal(0),
        },
      });
    }
  } else {
    const created = await prisma.user.create({
      data: {
        fullName: config.fullName,
        phoneNumber: normalizedPhone,
        password: passwordHash,
        role: UserRole.PLAYER,
        status: UserStatus.ACTIVE,
        autoMarkGranted: true,
        autoMarkEnabled: true,
        autoBingoGranted: true,
        autoBingoEnabled: true,
        wallet: {
          create: {
            balance: depositDecimal,
            lockedBalance: new Prisma.Decimal(0),
          },
        },
      },
    });
    userId = created.id;
  }

  // Create or update approved deposit record for traceability
  const transactionRef = `DEMO_SEED_${config.phoneNumber}`;
  let deposit = await prisma.deposit.findFirst({
    where: { userId, transactionRef },
  });

  if (!deposit) {
    deposit = await prisma.deposit.create({
      data: {
        userId,
        provider: PaymentProvider.TELEBIRR,
        amount: depositDecimal,
        transactionRef,
        status: DepositStatus.APPROVED,
        verifiedAmount: depositDecimal,
        verifiedReceiverName: 'Demo System',
        receiptUrl: null,
      },
    });
  } else {
    deposit = await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        amount: depositDecimal,
        status: DepositStatus.APPROVED,
        verifiedAmount: depositDecimal,
      },
    });
  }

  // Record wallet transaction
  const existingTx = await prisma.walletTransaction.findFirst({
    where: {
      userId,
      type: WalletTransactionType.DEPOSIT,
      referenceType: 'DEPOSIT',
      referenceId: deposit.id,
    },
  });

  if (!existingTx) {
    await prisma.walletTransaction.create({
      data: {
        userId,
        type: WalletTransactionType.DEPOSIT,
        amount: depositDecimal,
        balanceBefore: new Prisma.Decimal(0),
        balanceAfter: depositDecimal,
        referenceType: 'DEPOSIT',
        referenceId: deposit.id,
        description: 'Initial Demo Balance Credit (100 ETB)',
      },
    });
  }

  return {
    phone: config.phoneNumber,
    storedAs: normalizedPhone,
    fullName: config.fullName,
    userId,
    balance: config.depositAmount,
  };
}

async function ensurePlayableGame(prisma: PrismaClient) {
  // 1. Ensure cartelas exist
  const cartelaCount = await prisma.cartela.count();
  console.log(`Cartelas in database: ${cartelaCount}`);
  if (cartelaCount < 100) {
    console.log('Cartela count low, seeding cartelas from JSON...');
    await seedCartelas(prisma);
  }

  // 2. Ensure active GameRule
  const defaultRule = await prisma.gameRule.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (!defaultRule) {
    throw new Error('No active GameRule found. Run seed:game-rules first.');
  }
  console.log(`Using GameRule: ${defaultRule.name} (${defaultRule.key})`);

  // 3. Ensure AUTO GameSlot exists
  let slot = await prisma.gameSlot.findFirst({
    where: {
      category: GameCategory.NORMAL,
      status: { not: GameStatus.CANCELLED },
    },
  });

  if (!slot) {
    console.log('No active game slot found. Creating standard AUTO slot...');
    slot = await prisma.gameSlot.create({
      data: {
        staticCode: 'DEMO-SLOT-01',
        name: 'Classic Bingo (Full House)',
        gameType: defaultRule.key,
        gameRuleId: defaultRule.id,
        status: GameStatus.NEXT,
        category: GameCategory.NORMAL,
        entryFee: new Prisma.Decimal(10),
        prizePerCartela: new Prisma.Decimal(8),
        operationMode: GameOperationMode.AUTO,
        removeAfterFinish: false, // Ensures it continuously runs round after round!
        sortOrder: 1,
        registrationDurationSeconds: 120, // 2 minutes registration window
        autoCallIntervalSeconds: 3,
      },
    });
    console.log(`✓ Created GameSlot [${slot.id}] staticCode: ${slot.staticCode}`);
  } else {
    // Make sure it is AUTO and removeAfterFinish is false so it loops
    slot = await prisma.gameSlot.update({
      where: { id: slot.id },
      data: {
        operationMode: GameOperationMode.AUTO,
        removeAfterFinish: false,
        registrationDurationSeconds: 120,
        autoCallIntervalSeconds: 3,
      },
    });
    console.log(`✓ Active GameSlot ready: ${slot.name} (${slot.staticCode}) [${slot.id}]`);
  }

  // 4. Ensure an active READY or PLAYING session exists
  const activeSession = await prisma.gameSession.findFirst({
    where: {
      status: {
        in: [
          GameStatus.READY,
          GameStatus.PLAYING,
          GameStatus.CHECKING,
          GameStatus.WINNER_WINDOW,
        ],
      },
    },
    include: { gameSlot: true },
  });

  if (activeSession) {
    console.log(
      `✓ Already active session [${activeSession.id}] Status: ${activeSession.status}, scheduledStartAt: ${activeSession.scheduledStartAt}`,
    );
    return { slot, session: activeSession };
  }

  console.log('No active session found. Creating immediate READY session...');
  const newSession = await prisma.gameSession.create({
    data: {
      gameSlotId: slot.id,
      playCode: generatePlayCode(),
      entryFee: slot.entryFee,
      prizePerCartela: slot.prizePerCartela,
      companyFeePerCartela: slot.entryFee.sub(slot.prizePerCartela),
      prizeAmount: new Prisma.Decimal(0),
      companyRevenue: new Prisma.Decimal(0),
      status: GameStatus.READY,
      scheduledStartAt: new Date(Date.now() + 120 * 1000), // 2 minutes countdown
      roundIndex: 1,
      gameRuleId: defaultRule.id,
    },
  });

  console.log(
    `✓ Created GameSession [${newSession.id}] playCode: ${newSession.playCode} Status: READY (Starts in 120s)`,
  );

  return { slot, session: newSession };
}

async function main() {
  const prisma = createSeedPrismaClient();

  try {
    console.log('--- 1. Seeding Demo Players ---');
    for (const player of DEMO_PLAYERS) {
      const res = await seedDemoUser(prisma, player);
      console.log(
        `✓ Seeded ${res.fullName} | Phone: ${res.phone} (${res.storedAs}) | Password: ${player.password} | Balance: ${res.balance} ETB`,
      );
    }

    console.log('\n--- 2. Ensuring Playable Game Session & Slot ---');
    const { slot, session } = await ensurePlayableGame(prisma);

    console.log('\n=============================================');
    console.log('DEMO ENVIRONMENT READY FOR MOBILE APP TESTING');
    console.log('=============================================');
    console.log(`Active Slot: ${slot.name} (${slot.staticCode})`);
    console.log(`Session ID: ${session.id} | Status: ${session.status}`);
    console.log(`Entry Fee: ${slot.entryFee} ETB | Prize: ${slot.prizePerCartela} ETB / cartela`);
    console.log('=============================================');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed to setup demo environment:', err);
  process.exit(1);
});
