import { Prisma, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  ethiopianPhoneLookupVariants,
  normalizeEthiopianPhone,
} from '../common/utils/phone.util';
import { createSeedPrismaClient } from './create-seed-prisma-client';

export type SeedAdminInput = {
  phoneNumber: string;
  password: string;
  fullName: string;
};

export const DEFAULT_SEED_ADMINS: SeedAdminInput[] = [
  {
    phoneNumber: '0911111111',
    password: '12345678',
    fullName: 'Admin One',
  },
  {
    phoneNumber: '0911111112',
    password: '12345678',
    fullName: 'Admin Two',
  },
];

async function findUserByPhone(prisma: PrismaClient, phoneNumber: string) {
  return prisma.user.findFirst({
    where: {
      OR: ethiopianPhoneLookupVariants(phoneNumber).map((variant) => ({
        phoneNumber: variant,
      })),
    },
    select: { id: true, phoneNumber: true, role: true },
  });
}

export async function seedAdminUser(
  prisma: PrismaClient,
  input: SeedAdminInput,
) {
  const phoneNumber = normalizeEthiopianPhone(input.phoneNumber);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const existing = await findUserByPhone(prisma, phoneNumber);

  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName.trim(),
        phoneNumber,
        password: passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, phoneNumber: true, role: true },
    });

    return { user, created: false };
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: input.fullName.trim(),
        phoneNumber,
        password: passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, phoneNumber: true, role: true },
    });

    await tx.wallet.create({
      data: {
        userId: created.id,
        balance: new Prisma.Decimal(0),
        lockedBalance: new Prisma.Decimal(0),
      },
    });

    return created;
  });

  return { user, created: true };
}

export async function seedAdmins(
  prisma: PrismaClient,
  admins: SeedAdminInput[] = DEFAULT_SEED_ADMINS,
) {
  const results: Array<{
    user: { id: string; phoneNumber: string; role: UserRole };
    created: boolean;
    localPhone: string;
  }> = [];

  for (const admin of admins) {
    const result = await seedAdminUser(prisma, admin);
    results.push({
      ...result,
      localPhone: admin.phoneNumber,
    });
  }

  return results;
}

export async function runAdminSeed() {
  const prisma = createSeedPrismaClient();

  try {
    const results = await seedAdmins(prisma);

    for (const { user, created, localPhone } of results) {
      console.log(
        `Admin ${created ? 'created' : 'updated'} phone=${localPhone} storedAs=${user.phoneNumber} id=${user.id} role=${user.role}`,
      );
    }

    console.log(`Admin seed completed (${results.length} users).`);
  } finally {
    await prisma.$disconnect();
  }
}
