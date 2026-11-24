import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import {
  BOT_CALLBACK_QUERIES,
  TELEGRAM_BOT_POLLING_KEY,
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_BOT_USERNAME_KEY,
  TELEGRAM_MINIAPP_URL_KEY,
} from './telegram.constants';
import { handleStartCommand } from './commands/start.command';
import { handlePlayCommand } from './commands/play.command';
import {
  buildMiniappPathUrl,
  normalizeHttpsMiniappUrl,
} from './telegram-formatting.util';

export type TelegramBotMode = 'polling' | 'webhook' | 'disabled';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;
  private isPolling = false;
  private mode: TelegramBotMode = 'disabled';
  private initPromise: Promise<void> | null = null;
  private miniappUrl: string | undefined;
  private readonly interactionListeners = new Set<
    (telegramId: string) => void | Promise<void>
  >();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const token = this.configService.get<string>(TELEGRAM_BOT_TOKEN_KEY);
    if (!token?.trim()) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is not configured. Telegram bot features are inactive.',
      );
      return;
    }

    const rawMiniappUrl = this.configService.get<string>(
      TELEGRAM_MINIAPP_URL_KEY,
    );
    const miniappUrl = normalizeHttpsMiniappUrl(rawMiniappUrl);
    this.miniappUrl = miniappUrl;
    const botUsername =
      this.configService.get<string>(TELEGRAM_BOT_USERNAME_KEY) ||
      'FriendsBingoDevBot';

    this.bot = new Bot(token.trim());

    // Global error boundary
    this.bot.catch((err) => {
      this.logger.error(`[Telegram Bot Error] ${err.message}`, err.stack);
    });

    // Any incoming update from a user means they can receive bot messages again.
    this.bot.use(async (ctx, next) => {
      const fromId = ctx.from?.id;
      if (fromId) this.emitUserInteraction(String(fromId));
      await next();
    });

    // 1. App Launcher Commands (/start, /play, /app, /game, /lobby, /open)
    this.bot.command(
      ['start', 'play', 'app', 'game', 'lobby', 'open'],
      async (ctx) => {
        await handleStartCommand(ctx, miniappUrl);
      },
    );

    // 2. Callback query for App Launcher
    this.bot.callbackQuery(BOT_CALLBACK_QUERIES.PLAY, async (ctx) => {
      await ctx.answerCallbackQuery();
      await handlePlayCommand(ctx, miniappUrl);
    });

    // 3. Fallback message handler:
    // Guides any user text or message back to opening the Friends Bingo Mini App.
    this.bot.on('message', async (ctx) => {
      await handleStartCommand(ctx, miniappUrl);
    });

    // Check if long polling is explicitly enabled for development
    const pollingRaw = this.configService.get(TELEGRAM_BOT_POLLING_KEY);
    const pollingEnabled = pollingRaw === true || pollingRaw === 'true';

    if (pollingEnabled) {
      this.mode = 'polling';
      this.startPolling(botUsername);
    } else {
      this.mode = 'webhook';
      this.logger.log(
        `Telegram Bot initialized for webhook mode (@${botUsername}). Polling disabled.`,
      );

      // Eagerly initialize the bot so bot.me is available for webhook mode.
      try {
        await this.ensureBotInitialized();
        this.logger.log(
          `Telegram Bot fully initialized: @${this.bot.botInfo.username} (id: ${this.bot.botInfo.id})`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Telegram Bot startup init failed (will retry lazily on first webhook): ${err?.message}`,
        );
      }
    }
  }

  /** True when a bot token is configured and outgoing messages can be sent. */
  canSendMessages(): boolean {
    return this.bot !== null;
  }

  /** Absolute Mini App URL for `path`, or undefined when no HTTPS Mini App URL is configured. */
  buildMiniappUrl(path: string): string | undefined {
    return this.miniappUrl
      ? buildMiniappPathUrl(this.miniappUrl, path)
      : undefined;
  }

  /**
   * Sends an HTML message to a user chat, optionally with a `web_app` button
   * that opens the Mini App signed in. Errors (e.g. GrammyError 403/429) propagate.
   */
  async sendUserMessage(
    chatId: string | number,
    html: string,
    button?: { label: string; url: string },
  ): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not configured');
    await this.bot.api.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(button
        ? {
            reply_markup: {
              inline_keyboard: [
                [{ text: button.label, web_app: { url: button.url } }],
              ],
            },
          }
        : {}),
    });
  }

  onUserInteraction(
    listener: (telegramId: string) => void | Promise<void>,
  ): () => void {
    this.interactionListeners.add(listener);
    return () => this.interactionListeners.delete(listener);
  }

  emitUserInteraction(telegramId: string): void {
    this.interactionListeners.forEach((listener) => {
      void Promise.resolve(listener(telegramId)).catch(() => undefined);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot && this.isPolling) {
      this.logger.log('Stopping Telegram long polling...');
      await this.bot.stop();
      this.isPolling = false;
    }
  }

  /**
   * Ensure the grammY bot is initialized (bot.init() called, bot.me populated).
   * Deduplicates concurrent calls via a shared promise.
   * On failure, clears the promise so the next call retries.
   */
  async ensureBotInitialized(): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not configured');
    }

    if (this.bot.isInited()) {
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.bot
      .init()
      .then(() => {
        // Success: keep initPromise set so future calls resolve immediately
      })
      .catch((err) => {
        // Failure: clear the promise so next call retries
        this.initPromise = null;
        throw err;
      });

    await this.initPromise;
  }

  /**
   * Starts grammY long polling in development
   */
  private startPolling(username: string): void {
    if (!this.bot || this.isPolling) return;

    this.isPolling = true;
    this.logger.log(`Starting Telegram long polling for @${username}...`);

    this.bot
      .start({
        onStart: (botInfo) => {
          this.logger.log(
            `Telegram Bot long polling active: @${botInfo.username} (id: ${botInfo.id})`,
          );
        },
      })
      .catch((err) => {
        this.isPolling = false;
        this.logger.error(
          `Failed to start Telegram long polling: ${err.message}`,
          err.stack,
        );
      });
  }

  /**
   * Handles incoming webhook updates forwarded by TelegramController.
   * Ensures bot.init() has been called before processing.
   */
  async handleWebhookUpdate(update: Update): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not configured');
    }

    await this.ensureBotInitialized();
    await this.bot.handleUpdate(update);
  }

  getBotInstance(): Bot | null {
    return this.bot;
  }

  getMode(): TelegramBotMode {
    return this.mode;
  }

  getStatus(): {
    configured: boolean;
    initialized: boolean;
    mode: TelegramBotMode;
    botUsername?: string;
    botId?: number;
  } {
    const configured = this.bot !== null;
    const initialized = this.bot?.isInited() ?? false;

    return {
      configured,
      initialized,
      mode: this.mode,
      botUsername: initialized ? this.bot?.botInfo?.username : undefined,
      botId: initialized ? this.bot?.botInfo?.id : undefined,
    };
  }
}
