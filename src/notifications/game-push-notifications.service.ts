import { Injectable, Logger } from '@nestjs/common';
import { GameCategory, GameStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { gameSessionSelect } from '../games/games.select';
import { isBigGameCategory } from '../games/game-category.util';
import { pushNotificationMessages } from './push-notification-messages';

type SessionPayload = Prisma.GameSessionGetPayload<{
  select: typeof gameSessionSelect;
}>;

@Injectable()
export class GamePushNotificationsService {
  private readonly logger = new Logger(GamePushNotificationsService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  async notifyRegistrationOpened(session: SessionPayload) {
    const isBigGame = isBigGameCategory(session.gameSlot.category);
    const category = isBigGame
      ? 'BIG_GAME_REGISTRATION_OPEN'
      : 'REGISTRATION_OPEN';
    const gameName = this.gameName(session);
    const route = isBigGame ? '/games/big-game' : '/games';
    const title = isBigGame
      ? pushNotificationMessages.bigGameRegistrationOpen.title
      : pushNotificationMessages.registrationOpen.title;
    const body = isBigGame
      ? pushNotificationMessages.bigGameRegistrationOpen.body(gameName)
      : pushNotificationMessages.registrationOpen.body(gameName);

    await this.broadcastPush({
      category,
      title,
      body,
      route,
      entityId: session.id,
      data: this.sessionData(session),
    });
  }

  async notifyGameStarted(session: SessionPayload, userIds: string[]) {
    if (userIds.length === 0) {
      return;
    }

    const isBonus = session.gameSlot.category === GameCategory.BONUS;
    const category = isBonus ? 'BONUS_GAME_STARTED' : 'GAME_STARTED';
    const gameName = this.gameName(session);
    const gameLabel = this.gameLabel(session);
    const title = isBonus
      ? pushNotificationMessages.bonusGameStarted.title
      : pushNotificationMessages.gameStarted.title(gameName);
    const body = isBonus
      ? pushNotificationMessages.bonusGameStarted.body(gameName)
      : pushNotificationMessages.gameStarted.body(gameLabel);

    await this.notificationsService.sendAppNotificationToUsers(userIds, {
      category,
      title,
      body,
      route: this.liveRoute(session.id),
      entityId: session.id,
      data: {
        ...this.sessionData(session),
        gameCategory: session.gameSlot.category,
      },
    });
  }

  async notifyWinnerWindowStarted(
    sessionId: string,
    participantUserIds: string[],
  ) {
    if (participantUserIds.length === 0) {
      return;
    }

    await this.notificationsService.sendAppNotificationToUsers(
      participantUserIds,
      {
        category: 'WINNER_WINDOW_STARTED',
        title: pushNotificationMessages.winnerWindowStarted.title,
        body: pushNotificationMessages.winnerWindowStarted.body,
        route: this.liveRoute(sessionId),
        entityId: sessionId,
        data: { sessionId },
      },
    );
  }

  async runBigGameReminderTick(now = new Date()) {
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: { in: [GameStatus.READY, GameStatus.NEXT] },
        gameSlot: { category: GameCategory.BIG_GAME },
        scheduledStartAt: { not: null },
      },
      select: gameSessionSelect,
    });

    for (const session of sessions) {
      const scheduledStartAt = session.scheduledStartAt;
      if (!scheduledStartAt) {
        continue;
      }

      const msUntilStart = scheduledStartAt.getTime() - now.getTime();
      const hoursUntilStart = msUntilStart / (60 * 60 * 1000);
      const prize =
        session.gameSlot.fixedPrizeAmount?.toString() ??
        session.prizeAmount.toString();

      if (
        hoursUntilStart > 20 &&
        hoursUntilStart <= 28
      ) {
        await this.broadcastPush({
          category: 'BIG_GAME_TOMORROW',
          title: pushNotificationMessages.bigGameTomorrow.title,
          body: pushNotificationMessages.bigGameTomorrow.body(prize),
          route: '/games/big-game',
          entityId: session.id,
          data: this.sessionData(session),
        });
      }

      const sameDay =
        scheduledStartAt.getUTCFullYear() === now.getUTCFullYear() &&
        scheduledStartAt.getUTCMonth() === now.getUTCMonth() &&
        scheduledStartAt.getUTCDate() === now.getUTCDate();

      if (
        sameDay &&
        hoursUntilStart > 0 &&
        hoursUntilStart <= 12
      ) {
        await this.broadcastPush({
          category: 'BIG_GAME_TODAY',
          title: pushNotificationMessages.bigGameToday.title,
          body: pushNotificationMessages.bigGameToday.body(prize),
          route: '/games/big-game',
          entityId: session.id,
          data: this.sessionData(session),
        });
      }
    }
  }

  private async broadcastPush(
    payload: Parameters<
      NotificationsService['sendAppNotificationToUsers']
    >[1],
  ) {
    const userIds = await this.listPushEnabledUserIds();
    if (userIds.length === 0) {
      this.logger.log(
        `Push broadcast skipped category=${payload.category} reason=no_enabled_users`,
      );
      return;
    }

    const summary = await this.notificationsService.sendAppNotificationToUsers(
      userIds,
      payload,
    );
    this.logger.log(
      `Push broadcast category=${payload.category} users=${summary.userCount} sent=${summary.sentCount} failed=${summary.failedCount}`,
    );
  }

  private async listPushEnabledUserIds() {
    const devices = await this.prisma.pushDevice.findMany({
      where: { enabled: true },
      select: { userId: true },
      distinct: ['userId'],
    });
    return devices.map((device) => device.userId);
  }

  private gameName(session: SessionPayload) {
    return session.gameSlot.name?.trim() || pushNotificationMessages.defaultGameName;
  }

  private gameLabel(session: SessionPayload) {
    const name = this.gameName(session);
    return session.playCode ? `${name} (${session.playCode})` : name;
  }

  private liveRoute(sessionId: string) {
    return `/games?sessionId=${sessionId}`;
  }

  private sessionData(session: SessionPayload) {
    return {
      sessionId: session.id,
      slotId: session.gameSlotId,
      playCode: session.playCode,
      gameCategory: session.gameSlot.category,
      ...(session.scheduledStartAt
        ? { scheduledStartAt: session.scheduledStartAt.toISOString() }
        : {}),
      ...(session.registrationOpensAt
        ? { registrationOpensAt: session.registrationOpensAt.toISOString() }
        : {}),
    };
  }
}
