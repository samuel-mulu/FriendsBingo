import { Injectable, Logger } from '@nestjs/common';
import { GameCategory, GamePushMode, GameStatus, Prisma } from '@prisma/client';
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
    const eligibleUserIds = await this.filterSessionPushUserIds(userIds);
    if (eligibleUserIds.length === 0) {
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

    await this.notificationsService.sendAppNotificationToUsers(eligibleUserIds, {
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
    const eligibleUserIds =
      await this.filterSessionPushUserIds(participantUserIds);
    if (eligibleUserIds.length === 0) {
      return;
    }

    await this.notificationsService.sendAppNotificationToUsers(
      eligibleUserIds,
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

  async notifyGameFinished(params: {
    sessionId: string;
    slotId: string;
    playCode: string;
    gameName: string;
    gameLabel: string;
    userIds: string[];
  }) {
    const eligibleUserIds = await this.filterSessionPushUserIds(params.userIds);
    if (eligibleUserIds.length === 0) {
      return { userCount: 0, sentCount: 0, failedCount: 0 };
    }

    return this.notificationsService.sendAppNotificationToUsers(
      eligibleUserIds,
      {
        category: 'GAME_FINISHED',
        title: pushNotificationMessages.gameFinished.title(params.gameName),
        body: pushNotificationMessages.gameFinished.body(params.gameLabel),
        route: '/games',
        entityId: params.sessionId,
        data: {
          sessionId: params.sessionId,
          slotId: params.slotId,
          playCode: params.playCode,
        },
      },
    );
  }

  async notifyWinnerAnnouncement(params: {
    sessionId: string;
    slotId: string;
    gameName: string;
    userIds: string[];
  }) {
    const eligibleUserIds = await this.filterSessionPushUserIds(params.userIds);
    if (eligibleUserIds.length === 0) {
      return { userCount: 0, sentCount: 0, failedCount: 0 };
    }

    return this.notificationsService.sendAppNotificationToUsers(
      eligibleUserIds,
      {
        category: 'WINNER_ANNOUNCEMENT',
        title: pushNotificationMessages.winnerAnnouncement.title,
        body: pushNotificationMessages.winnerAnnouncement.body(params.gameName),
        route: '/games',
        entityId: params.sessionId,
        data: {
          sessionId: params.sessionId,
          slotId: params.slotId,
        },
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

      if (hoursUntilStart > 20 && hoursUntilStart <= 28) {
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

      if (sameDay && hoursUntilStart > 0 && hoursUntilStart <= 12) {
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

  async notifyBigGameTicketGranted(params: {
    userId: string;
    ticketCount: number;
    gameName: string;
    bigGameSlotId: string;
    netPrizeAmount?: string;
  }) {
    const { userId, ticketCount, gameName, bigGameSlotId, netPrizeAmount } =
      params;
    const eligibleUserIds = await this.filterSessionPushUserIds([userId]);
    if (eligibleUserIds.length === 0) {
      return;
    }

    await this.notificationsService.sendAppNotificationToUsers(eligibleUserIds, {
      category: 'BIG_GAME_TICKET_GRANTED',
      title: pushNotificationMessages.bigGameTicketGranted.title,
      body: pushNotificationMessages.bigGameTicketGranted.body(
        ticketCount,
        gameName,
      ),
      route: '/games/big-game',
      entityId: `${bigGameSlotId}:${userId}`,
      data: {
        bigGameSlotId,
        ticketCount: String(ticketCount),
        ...(netPrizeAmount ? { netPrizeAmount } : {}),
      },
    });
  }

  /**
   * Broadcast audience: enabled devices whose user opted into ALWAYS.
   * REGISTERED_ONLY and OFF are excluded without scanning cartelas.
   */
  async listBroadcastPushUserIds() {
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        enabled: true,
        user: { gamePushMode: GamePushMode.ALWAYS },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return devices.map((device) => device.userId);
  }

  /**
   * Session audience: keep ALWAYS and REGISTERED_ONLY; drop OFF.
   * Operates on the already-small participant id list.
   */
  async filterSessionPushUserIds(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        gamePushMode: { not: GamePushMode.OFF },
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private async broadcastPush(
    payload: Parameters<NotificationsService['sendAppNotificationToUsers']>[1],
  ) {
    const userIds = await this.listBroadcastPushUserIds();
    if (userIds.length === 0) {
      this.logger.log(
        `Push broadcast skipped category=${payload.category} reason=no_enabled_users`,
      );
      return;
    }

    await this.notificationsService.sendAppNotificationToUsers(
      userIds,
      payload,
    );
  }

  private gameName(session: SessionPayload) {
    return (
      session.gameSlot.name?.trim() || pushNotificationMessages.defaultGameName
    );
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
