import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GLOBAL_PUSH_MAX_PER_WINDOW,
  GLOBAL_PUSH_WINDOW_MS,
  isMarketingCategory,
  isRateExemptCategory,
  MARKETING_PUSH_MAX_PER_WINDOW,
  MARKETING_PUSH_WINDOW_MS,
  normalizePushEntityId,
} from './push-rate-policy';
import type { AppPushNotificationPayload } from './types/push-category.type';

@Injectable()
export class PushDeliveryGuardService {
  private readonly logger = new Logger(PushDeliveryGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async filterUsersForPush(
    userIds: string[],
    payload: AppPushNotificationPayload,
    now = new Date(),
  ) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    const entityId = normalizePushEntityId(payload.entityId);
    const dedupedUserIds = await this.filterAlreadyDelivered(
      uniqueUserIds,
      payload.category,
      entityId,
    );
    if (dedupedUserIds.length === 0) {
      this.logger.log(
        `Push skipped category=${payload.category} entityId=${entityId || 'none'} reason=all_users_deduped`,
      );
      return [];
    }

    if (isRateExemptCategory(payload.category)) {
      return dedupedUserIds;
    }

    const rateLimitedUserIds = await this.filterRateLimitedUsers(
      dedupedUserIds,
      payload.category,
      now,
    );
    const skippedCount = dedupedUserIds.length - rateLimitedUserIds.length;
    if (skippedCount > 0) {
      this.logger.log(
        `Push rate-limited category=${payload.category} entityId=${entityId || 'none'} skippedUsers=${skippedCount}`,
      );
    }

    return rateLimitedUserIds;
  }

  async recordSuccessfulPush(
    userId: string,
    payload: AppPushNotificationPayload,
    sentAt = new Date(),
  ) {
    const entityId = normalizePushEntityId(payload.entityId);

    try {
      await this.prisma.pushDeliveryLog.create({
        data: {
          userId,
          category: payload.category,
          entityId,
          sentAt,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  async reserveDeliveries(
    userIds: string[],
    payload: AppPushNotificationPayload,
    sentAt: Date = new Date(),
  ): Promise<{
    reservedUserIds: string[];
    skippedDuplicates: number;
  }> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return {
        reservedUserIds: [],
        skippedDuplicates: 0,
      };
    }

    const entityId = normalizePushEntityId(payload.entityId);
    const rows = uniqueUserIds.map(
      (userId) => Prisma.sql`(
      ${randomUUID()},
      ${userId},
      ${payload.category},
      ${entityId},
      ${sentAt}
    )`,
    );

    const reserved = await this.prisma.$queryRaw<Array<{ userId: string }>>(
      Prisma.sql`
        INSERT INTO "PushDeliveryLog" (
          "id",
          "userId",
          "category",
          "entityId",
          "sentAt"
        )
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("userId", "category", "entityId")
        DO NOTHING
        RETURNING "userId"
      `,
    );

    return {
      reservedUserIds: reserved.map((entry) => entry.userId),
      skippedDuplicates: uniqueUserIds.length - reserved.length,
    };
  }

  private async filterAlreadyDelivered(
    userIds: string[],
    category: string,
    entityId: string,
  ) {
    const delivered = await this.prisma.pushDeliveryLog.findMany({
      where: {
        userId: { in: userIds },
        category,
        entityId,
      },
      select: { userId: true },
    });

    const deliveredUserIds = new Set(delivered.map((entry) => entry.userId));
    return userIds.filter((userId) => !deliveredUserIds.has(userId));
  }

  private async filterRateLimitedUsers(
    userIds: string[],
    category: AppPushNotificationPayload['category'],
    now: Date,
  ) {
    const globalWindowStart = new Date(now.getTime() - GLOBAL_PUSH_WINDOW_MS);
    const globalCounts = await this.countDeliveriesByUser(
      userIds,
      globalWindowStart,
    );

    let eligibleUserIds = userIds.filter(
      (userId) => (globalCounts.get(userId) ?? 0) < GLOBAL_PUSH_MAX_PER_WINDOW,
    );

    if (!isMarketingCategory(category) || eligibleUserIds.length === 0) {
      return eligibleUserIds;
    }

    const marketingWindowStart = new Date(
      now.getTime() - MARKETING_PUSH_WINDOW_MS,
    );
    const marketingCounts = await this.countDeliveriesByUser(
      eligibleUserIds,
      marketingWindowStart,
      [...PUSH_MARKETING_CATEGORY_LIST],
    );

    eligibleUserIds = eligibleUserIds.filter(
      (userId) =>
        (marketingCounts.get(userId) ?? 0) < MARKETING_PUSH_MAX_PER_WINDOW,
    );

    return eligibleUserIds;
  }

  private async countDeliveriesByUser(
    userIds: string[],
    since: Date,
    categories?: string[],
  ) {
    if (userIds.length === 0) {
      return new Map<string, number>();
    }

    const grouped = await this.prisma.pushDeliveryLog.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        sentAt: { gte: since },
        ...(categories ? { category: { in: categories } } : {}),
      },
      _count: { _all: true },
    });

    return new Map(grouped.map((entry) => [entry.userId, entry._count._all]));
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}

const PUSH_MARKETING_CATEGORY_LIST = [
  'REGISTRATION_OPEN',
  'BIG_GAME_REGISTRATION_OPEN',
  'BIG_GAME_TOMORROW',
  'BIG_GAME_TODAY',
] as const;
