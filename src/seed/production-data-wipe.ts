import { Prisma, PrismaClient, UserRole } from '@prisma/client';

import { createSeedPrismaClient } from './create-seed-prisma-client';

export type WipeCountSummary = Record<string, number>;

function logCount(label: string, count: number) {
  console.log(`  ${label}: ${count}`);
}

export async function wipeProductionData(
  prisma: PrismaClient,
): Promise<WipeCountSummary> {
  const counts: WipeCountSummary = {};

  console.log('Wiping production transactional data (ordered by FK)...');

  await prisma.$transaction(async (tx) => {
    const bingoClaim = await tx.bingoClaim.deleteMany();
    counts.BingoClaim = bingoClaim.count;
    logCount('BingoClaim', bingoClaim.count);

    const dismissals = await tx.adminBroadcastDismissal.deleteMany();
    counts.AdminBroadcastDismissal = dismissals.count;
    logCount('AdminBroadcastDismissal', dismissals.count);

    const calledNumbers = await tx.calledNumber.deleteMany();
    counts.CalledNumber = calledNumbers.count;
    logCount('CalledNumber', calledNumbers.count);

    const reservations = await tx.gameCartelaReservation.deleteMany();
    counts.GameCartelaReservation = reservations.count;
    logCount('GameCartelaReservation', reservations.count);

    const gameCartelas = await tx.gameCartela.deleteMany();
    counts.GameCartela = gameCartelas.count;
    logCount('GameCartela', gameCartelas.count);

    const pushDeliveryLogs = await tx.pushDeliveryLog.deleteMany();
    counts.PushDeliveryLog = pushDeliveryLogs.count;
    logCount('PushDeliveryLog', pushDeliveryLogs.count);

    const pushDevices = await tx.pushDevice.deleteMany();
    counts.PushDevice = pushDevices.count;
    logCount('PushDevice', pushDevices.count);

    const supportMessages = await tx.playerSupportMessage.deleteMany();
    counts.PlayerSupportMessage = supportMessages.count;
    logCount('PlayerSupportMessage', supportMessages.count);

    const notifications = await tx.notification.deleteMany();
    counts.Notification = notifications.count;
    logCount('Notification', notifications.count);

    const refreshTokens = await tx.refreshToken.deleteMany();
    counts.RefreshToken = refreshTokens.count;
    logCount('RefreshToken', refreshTokens.count);

    const withdrawals = await tx.withdrawal.deleteMany();
    counts.Withdrawal = withdrawals.count;
    logCount('Withdrawal', withdrawals.count);

    const deposits = await tx.deposit.deleteMany();
    counts.Deposit = deposits.count;
    logCount('Deposit', deposits.count);

    const walletTransactions = await tx.walletTransaction.deleteMany();
    counts.WalletTransaction = walletTransactions.count;
    logCount('WalletTransaction', walletTransactions.count);

    const wallets = await tx.wallet.deleteMany();
    counts.Wallet = wallets.count;
    logCount('Wallet', wallets.count);

    const auditLogs = await tx.auditLog.deleteMany();
    counts.AuditLog = auditLogs.count;
    logCount('AuditLog', auditLogs.count);

    const broadcasts = await tx.adminBroadcast.deleteMany();
    counts.AdminBroadcast = broadcasts.count;
    logCount('AdminBroadcast', broadcasts.count);

    const expenses = await tx.adminExpense.deleteMany();
    counts.AdminExpense = expenses.count;
    logCount('AdminExpense', expenses.count);

    const otpChallenges = await tx.otpChallenge.deleteMany();
    counts.OtpChallenge = otpChallenges.count;
    logCount('OtpChallenge', otpChallenges.count);

    const smsLogs = await tx.smsDeliveryLog.deleteMany();
    counts.SmsDeliveryLog = smsLogs.count;
    logCount('SmsDeliveryLog', smsLogs.count);

    const sessions = await tx.gameSession.deleteMany();
    counts.GameSession = sessions.count;
    logCount('GameSession', sessions.count);

    const slots = await tx.gameSlot.deleteMany();
    counts.GameSlot = slots.count;
    logCount('GameSlot', slots.count);

    const timingCleared = await tx.gameTimingConfig.updateMany({
      where: { updatedById: { not: null } },
      data: { updatedById: null },
    });
    counts.GameTimingConfigUpdatedByCleared = timingCleared.count;
    logCount('GameTimingConfig.updatedById cleared', timingCleared.count);

    const players = await tx.user.deleteMany({
      where: { role: { not: UserRole.ADMIN } },
    });
    counts.UserNonAdmin = players.count;
    logCount('User (non-ADMIN)', players.count);

    const admins = await tx.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true, wallet: { select: { id: true } } },
    });

    let walletsRecreated = 0;
    for (const admin of admins) {
      if (admin.wallet) {
        continue;
      }

      await tx.wallet.create({
        data: {
          userId: admin.id,
          balance: new Prisma.Decimal(0),
          lockedBalance: new Prisma.Decimal(0),
        },
      });
      walletsRecreated += 1;
    }

    counts.AdminWalletsRecreated = walletsRecreated;
    logCount('Admin wallets recreated', walletsRecreated);
    counts.AdminUsersKept = admins.length;
    logCount('Admin users kept', admins.length);
  });

  return counts;
}

async function main() {
  const prisma = createSeedPrismaClient();

  try {
    console.log('Starting production data wipe...');
    const counts = await wipeProductionData(prisma);

    const cartelaCount = await prisma.cartela.count();
    const gameRuleCount = await prisma.gameRule.count();
    const timingCount = await prisma.gameTimingConfig.count();
    const adminCount = await prisma.user.count({
      where: { role: UserRole.ADMIN },
    });
    const playerCount = await prisma.user.count({
      where: { role: UserRole.PLAYER },
    });

    console.log('Preserved:');
    console.log(`  Cartela: ${cartelaCount}`);
    console.log(`  GameRule: ${gameRuleCount}`);
    console.log(`  GameTimingConfig: ${timingCount}`);
    console.log(`  ADMIN users: ${adminCount}`);
    console.log(`  PLAYER users remaining: ${playerCount}`);
    console.log(
      `Production data wipe completed successfully (${Object.keys(counts).length} steps).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Production data wipe failed:', error);
  process.exitCode = 1;
});
