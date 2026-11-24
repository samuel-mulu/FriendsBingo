import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GrammyError } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import type { AppPushNotificationPayload } from '../notifications/types/push-category.type';
import { mapWithConcurrency } from '../notifications/utils/map-with-concurrency';
import { mapPushRouteToMiniappPath } from './telegram-deeplink.util';
import { escapeTelegramHtml } from './telegram-formatting.util';
import { TelegramService } from './telegram.service';

/** Telegram allows ~30 messages/second per bot; stay comfortably below it. */
const SEND_CONCURRENCY = 15;
const MAX_RETRY_AFTER_SECONDS = 30;
const OPEN_BUTTON_LABEL = '🎮 Open Friends Bingo';

export interface TelegramNotifySummary {
  targeted: number;
  sent: number;
  blocked: number;
  failed: number;
  /** User ids whose Telegram message was delivered. */
  deliveredUserIds: string[];
}

const EMPTY_SUMMARY: TelegramNotifySummary = {
  targeted: 0,
  sent: 0,
  blocked: 0,
  failed: 0,
  deliveredUserIds: [],
};

type SendOutcome = 'sent' | 'blocked' | 'failed';

/**
 * Delivers app notifications to players through the Telegram bot, with a
 * `web_app` button that opens the matching Mini App screen already signed in.
 * Players who blocked the bot are flagged and skipped until they come back.
 */
@Injectable()
export class TelegramNotifierService implements OnModuleInit {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit(): void {
    // A player who messages the bot again has unblocked it: resume notifications.
    this.telegramService.onUserInteraction((telegramId) =>
      this.clearBlockedFlag(telegramId),
    );
  }

  async notifyUsers(
    userIds: string[],
    payload: Pick<
      AppPushNotificationPayload,
      'category' | 'title' | 'body' | 'route'
    >,
  ): Promise<TelegramNotifySummary> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0 || !this.telegramService.canSendMessages()) {
      return { ...EMPTY_SUMMARY };
    }

    const recipients = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        telegramId: { not: null },
        telegramNotificationsBlockedAt: null,
      },
      select: { id: true, telegramId: true },
    });
    if (recipients.length === 0) return { ...EMPTY_SUMMARY };

    const text = this.renderText(payload);
    const url = this.telegramService.buildMiniappUrl(
      mapPushRouteToMiniappPath(payload.route),
    );

    const outcomes = await mapWithConcurrency(
      recipients,
      SEND_CONCURRENCY,
      async (recipient) => ({
        userId: recipient.id,
        outcome: await this.sendWithRetry(
          recipient.id,
          recipient.telegramId as string,
          text,
          url,
        ),
      }),
    );

    const summary: TelegramNotifySummary = {
      targeted: recipients.length,
      sent: 0,
      blocked: 0,
      failed: 0,
      deliveredUserIds: [],
    };
    for (const result of outcomes) {
      if (!result.ok) {
        summary.failed += 1;
        continue;
      }
      const { userId, outcome } = result.value;
      summary[outcome] += 1;
      if (outcome === 'sent') summary.deliveredUserIds.push(userId);
    }

    this.logger.log(
      `Telegram notify category=${payload.category} targeted=${summary.targeted} sent=${summary.sent} blocked=${summary.blocked} failed=${summary.failed}`,
    );
    return summary;
  }

  /** Called when a player interacts with the bot again (sending a message implies they unblocked it). */
  async clearBlockedFlag(telegramId: string): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { telegramId, telegramNotificationsBlockedAt: { not: null } },
        data: { telegramNotificationsBlockedAt: null },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to clear Telegram blocked flag: ${(error as Error).message}`,
      );
    }
  }

  private renderText(
    payload: Pick<AppPushNotificationPayload, 'title' | 'body'>,
  ): string {
    const title = escapeTelegramHtml(payload.title.trim());
    const body = escapeTelegramHtml(payload.body.trim());
    return body ? `<b>${title}</b>\n${body}` : `<b>${title}</b>`;
  }

  private async sendWithRetry(
    userId: string,
    chatId: string,
    text: string,
    url: string | undefined,
    attempt = 0,
  ): Promise<SendOutcome> {
    try {
      await this.telegramService.sendUserMessage(
        chatId,
        text,
        url ? { label: OPEN_BUTTON_LABEL, url } : undefined,
      );
      return 'sent';
    } catch (error) {
      if (error instanceof GrammyError) {
        if (error.error_code === 403) {
          await this.markBlocked(userId);
          return 'blocked';
        }
        const retryAfter = error.parameters?.retry_after;
        if (
          error.error_code === 429 &&
          attempt === 0 &&
          retryAfter &&
          retryAfter <= MAX_RETRY_AFTER_SECONDS
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000),
          );
          return this.sendWithRetry(userId, chatId, text, url, attempt + 1);
        }
        this.logger.warn(
          `Telegram send failed userId=${userId} code=${error.error_code} ${error.description}`,
        );
        return 'failed';
      }
      this.logger.warn(
        `Telegram send failed userId=${userId} ${(error as Error)?.message}`,
      );
      return 'failed';
    }
  }

  private async markBlocked(userId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { telegramNotificationsBlockedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to flag Telegram-blocked user ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
