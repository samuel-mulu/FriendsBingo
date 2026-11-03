import 'dotenv/config';
import { Prisma, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { normalizeEthiopianPhone } from '../src/common/utils/phone.util';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function upsertAccount(params: {
  phoneNumber: string;
  passwordRaw: string;
  fullName: string;
  role: UserRole;
  balance: number;
}) {
  const normalized = normalizeEthiopianPhone(params.phoneNumber);
  const passwordHash = await bcrypt.hash(params.passwordRaw, 10);

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { phoneNumber: normalized },
        { phoneNumber: params.phoneNumber },
        { phoneNumber: `+${normalized}` },
        { phoneNumber: `0${normalized.slice(3)}` },
      ],
    },
    include: { wallet: true },
  });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        phoneNumber: normalized,
        password: passwordHash,
        fullName: params.fullName,
        role: params.role,
        status: UserStatus.ACTIVE,
      },
    });

    if (existing.wallet) {
      if (Number(existing.wallet.balance) < params.balance) {
        await prisma.wallet.update({
          where: { userId: existing.id },
          data: { balance: new Prisma.Decimal(params.balance) },
        });
      }
    } else {
      await prisma.wallet.create({
        data: {
          userId: existing.id,
          balance: new Prisma.Decimal(params.balance),
          lockedBalance: new Prisma.Decimal(0),
        },
      });
    }

    return { user: updated, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phoneNumber: normalized,
        password: passwordHash,
        fullName: params.fullName,
        role: params.role,
        status: UserStatus.ACTIVE,
      },
    });

    await tx.wallet.create({
      data: {
        userId: user.id,
        balance: new Prisma.Decimal(params.balance),
        lockedBalance: new Prisma.Decimal(0),
      },
    });

    return user;
  });

  return { user: created, created: true };
}

async function main() {
  console.log('--- SEEDING DEMO ACCOUNTS ---');

  // 1. Admin Accounts
  const admin1 = await upsertAccount({
    phoneNumber: '0911111111',
    passwordRaw: '12345678',
    fullName: 'Demo Admin',
    role: UserRole.ADMIN,
    balance: 0,
  });
  console.log(
    `Admin 1: phone=0911111111 (stored: ${admin1.user.phoneNumber}) created=${admin1.created}`,
  );

  const admin2 = await upsertAccount({
    phoneNumber: '0911111112',
    passwordRaw: '12345678',
    fullName: 'Demo Super Admin',
    role: UserRole.ADMIN,
    balance: 0,
  });
  console.log(
    `Admin 2: phone=0911111112 (stored: ${admin2.user.phoneNumber}) created=${admin2.created}`,
  );

  // 2. Demo Player Accounts for Mobile Testing
  const player1 = await upsertAccount({
    phoneNumber: '0922222222',
    passwordRaw: '12345678',
    fullName: 'Demo Player One',
    role: UserRole.PLAYER,
    balance: 500,
  });
  console.log(
    `Player 1: phone=0922222222 (stored: ${player1.user.phoneNumber}) balance=500 ETB created=${player1.created}`,
  );

  const player2 = await upsertAccount({
    phoneNumber: '0933333333',
    passwordRaw: '12345678',
    fullName: 'Demo Player Two',
    role: UserRole.PLAYER,
    balance: 250,
  });
  console.log(
    `Player 2: phone=0933333333 (stored: ${player2.user.phoneNumber}) balance=250 ETB created=${player2.created}`,
  );

  console.log('--- DEMO SEED FINISHED SUCCESSFULLY ---');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
