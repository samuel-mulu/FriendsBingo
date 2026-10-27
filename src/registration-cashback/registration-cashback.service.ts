import { Injectable, Logger } from '@nestjs/common';
import {
  CartelaPaymentSource,
  GameCategory,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { pushNotificationMessages } from '../notifications/push-notification-messages';
import { PrismaService } from '../prisma/prisma.service';
type PrismaDbClient = Prisma.TransactionClient | PrismaService;
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { RegistrationCashbackConfigService } from './registration-cashback-config.service';
import { REGISTRATION_CASHBACK_REFERENCE_TYPE } from './registration-cashback.defaults';
import { resolveRegistrationCashbackTier } from './registration-cashback.tiers.util';
import { RegistrationCashbackSettlementPayload } from './registration-cashback.types';
import {
  isQualifyingRegistrationPayment,
  isRegistrationCashbackEligibleCategory,
} from './registration-cashback.util';

@Injectable()
export class RegistrationCashbackService {
  private readonly logger = new Logger(RegistrationCashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: RegistrationCashbackConfigService,
    private readonly walletService: WalletService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async recordQualifyingRegistration(
    db: PrismaDbClient,
    params: {
      userId: string;
      gameSessionId: string;
      category: GameCategory;
      paymentSource: CartelaPaymentSource | null;
    },
  ): Promise<void> {
    const config = await this.configService.getEffectiveConfig();
    if (!config.enabled) {
      return;
    }
    if (!isRegistrationCashbackEligibleCategory(params.category)) {
      return;
    }
    if (!isQualifyingRegistrationPayment(params.paymentSource)) {
      return;
    }

    await db.registrationCashbackAccrual.upsert({
      where: {
        gameSessionId_userId: {
          gameSessionId: params.gameSessionId,
          userId: params.userId,
        },
      },
      create: {
        gameSessionId: params.gameSessionId,
        userId: params.userId,
        qualifyingCount: 1,
      },
      update: {
        qualifyingCount: { increment: 1 },
      },
    });

    await db.user.update({
      where: { id: params.userId },
      data: {
        lifetimeQualifyingRegistrationCount: { increment: 1 },
      },
    });
  }

  async settleForSession(gameSessionId: string): Promise<void> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: gameSessionId },
      select: {
        id: true,
        gameSlot: { select: { category: true } },
      },
    });

    if (!session) {
      return;
    }

    const category = session.gameSlot.category;
    if (!isRegistrationCashbackEligibleCategory(category)) {
      return;
    }

    const config = await this.configService.getEffectiveConfig();
    if (!config.enabled || config.tiers.length === 0) {
      return;
    }

    const accruals = await this.prisma.registrationCashbackAccrual.findMany({
      where: {
        gameSessionId,
        qualifyingCount: { gt: 0 },
      },
      select: {
        userId: true,
        qualifyingCount: true,
      },
    });

    if (accruals.length === 0) {
      return;
    }

    const settlements: RegistrationCashbackSettlementPayload[] = [];

    for (const accrual of accruals) {
      const tier = resolveRegistrationCashbackTier(
        accrual.qualifyingCount,
        config.tiers,
      );
      if (!tier) {
        continue;
      }

      try {
        const payload = await this.settleForUserInSession({
          userId: accrual.userId,
          gameSessionId,
          category,
          sessionQualifyingCount: accrual.qualifyingCount,
          tierMinCartelas: tier.minCartelasInSession,
          rewardEtb: tier.rewardEtb,
        });
        if (payload) {
          settlements.push(payload);
        }
      } catch (error) {
        this.logger.warn(
          `Registration cashback settlement failed user=${accrual.userId} session=${gameSessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const settlement of settlements) {
      await this.emitSettlementSideEffects(settlement);
    }
  }

  private async settleForUserInSession(params: {
    userId: string;
    gameSessionId: string;
    category: GameCategory;
    sessionQualifyingCount: number;
    tierMinCartelas: number;
    rewardEtb: string;
  }): Promise<RegistrationCashbackSettlementPayload | null> {
    const rewardAmount = new Prisma.Decimal(params.rewardEtb);

    const result = await this.prisma.$transaction(async (tx) => {
      const existingGrant = await tx.registrationCashbackGrant.findUnique({
        where: {
          userId_gameSessionId: {
            userId: params.userId,
            gameSessionId: params.gameSessionId,
          },
        },
        select: { id: true },
      });
      if (existingGrant) {
        return null;
      }

      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { lifetimeQualifyingRegistrationCount: true },
      });
      if (!user) {
        return null;
      }

      const walletTransactionId = await this.walletService.creditWallet(
        tx,
        params.userId,
        rewardAmount,
        {
          type: WalletTransactionType.REGISTRATION_CASHBACK,
          referenceType: REGISTRATION_CASHBACK_REFERENCE_TYPE,
          referenceId: params.gameSessionId,
          description: `Cartela milestone cashback (${params.sessionQualifyingCount} cartelas)`,
        },
      );

      await tx.registrationCashbackGrant.create({
        data: {
          userId: params.userId,
          gameSessionId: params.gameSessionId,
          gameSlotCategory: params.category,
          sessionQualifyingCountAtGrant: params.sessionQualifyingCount,
          lifetimeQualifyingCountAtGrant:
            user.lifetimeQualifyingRegistrationCount,
          tierMinCartelas: params.tierMinCartelas,
          rewardEtb: rewardAmount,
          walletTransactionId,
        },
      });

      return {
        userId: params.userId,
        amount: rewardAmount.toString(),
        sessionQualifyingCount: params.sessionQualifyingCount,
        lifetimeQualifyingCount: user.lifetimeQualifyingRegistrationCount,
        tierMinCartelas: params.tierMinCartelas,
        gameSessionId: params.gameSessionId,
      };
    });

    return result;
  }

  private async emitSettlementSideEffects(
    settlement: RegistrationCashbackSettlementPayload,
  ): Promise<void> {
    try {
      const wallet = await this.walletService.getSerializedWallet(
        settlement.userId,
      );
      this.realtimeService.emitToUser(
        settlement.userId,
        'wallet:updated',
        wallet,
      );
      this.realtimeService.emitToUser(
        settlement.userId,
        'wallet:registration_cashback',
        settlement,
      );

      await this.notificationsService.sendAppNotificationToUser(
        settlement.userId,
        {
          category: 'REGISTRATION_CASHBACK',
          title: pushNotificationMessages.registrationCashback.title,
          body: pushNotificationMessages.registrationCashback.body(
            settlement.amount,
            settlement.sessionQualifyingCount,
          ),
          route: '/wallet',
          entityId: settlement.gameSessionId,
          data: {
            gameSessionId: settlement.gameSessionId,
            amount: settlement.amount,
            sessionQualifyingCount: String(settlement.sessionQualifyingCount),
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Registration cashback side effects failed user=${settlement.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
