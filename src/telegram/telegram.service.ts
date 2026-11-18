import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  BOT_CALLBACK_QUERIES,
  TELEGRAM_BOT_POLLING_KEY,
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_BOT_USERNAME_KEY,
  TELEGRAM_MINIAPP_URL_KEY,
} from './telegram.constants';
import { handleStartCommand } from './commands/start.command';
import { handleHelpCommand } from './commands/help.command';
import { handlePlayCommand } from './commands/play.command';
import { handleGamesCommand } from './commands/games.command';
import { handleWalletCommand } from './commands/wallet.command';
import { normalizeHttpsMiniappUrl } from './telegram-formatting.util';

export type TelegramBotMode = 'polling' | 'webhook' | 'disabled';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;
  private isPolling = false;
  private mode: TelegramBotMode = 'disabled';
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
    const botUsername =
      this.configService.get<string>(TELEGRAM_BOT_USERNAME_KEY) ||
      'FriendsBingoDevBot';

    this.bot = new Bot(token.trim());

    // Global error boundary
    this.bot.catch((err) => {
      this.logger.error(`[Telegram Bot Error] ${err.message}`, err.stack);
    });

    // Register Commands
    this.bot.command('start', async (ctx) => {
      await handleStartCommand(ctx, miniappUrl);
    });

    this.bot.command(['play', 'lobby'], async (ctx) => {
      await handlePlayCommand(ctx, miniappUrl);
    });

    this.bot.command(['games', 'rooms'], async (ctx) => {
      await handleGamesCommand(ctx, this.prisma, miniappUrl);
    });

    this.bot.command(['wallet', 'balance', 'deposit'], async (ctx) => {
      await handleWalletCommand(ctx, this.prisma, miniappUrl);
    });

    this.bot.command(['help', 'rules'], async (ctx) => {
      await handleHelpCommand(ctx, miniappUrl);
    });

    // Register Callback Queries
    this.bot.callbackQuery(BOT_CALLBACK_QUERIES.HELP, async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleHelpCommand(ctx, miniappUrl);
    });

    this.bot.callbackQuery(BOT_CALLBACK_QUERIES.PLAY, async (ctx) => {
      await ctx.answerCallbackQuery();
      await handlePlayCommand(ctx, miniappUrl);
    });

    this.bot.callbackQuery(BOT_CALLBACK_QUERIES.GAMES, async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleGamesCommand(ctx, this.prisma, miniappUrl);
    });

    this.bot.callbackQuery(BOT_CALLBACK_QUERIES.WALLET, async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleWalletCommand(ctx, this.prisma, miniappUrl);
    });

    // Check if long polling is explicitly enabled for development
    const pollingRaw = this.configService.get(TELEGRAM_BOT_POLLING_KEY);
    const pollingEnabled =
      pollingRaw === true || pollingRaw === 'true';

    if (pollingEnabled) {
      this.mode = 'polling';
      this.startPolling(botUsername);
    } else {
      this.mode = 'webhook';
      this.logger.log(
        `Telegram Bot initialized for webhook mode (@${botUsername}). Polling disabled.`,
      );

      // Eagerly initialize the bot so bot.me is available for webhook mode.
      // On transient Telegram API failure, log a warning instead of crashing startup;
      // ensureBotInitialized() will retry lazily on the first webhook request.
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

    this.bot.start({
      onStart: (botInfo) => {
        this.logger.log(
          `Telegram Bot long polling active: @${botInfo.username} (id: ${botInfo.id})`,
        );
      },
    }).catch((err) => {
      this.isPolling = false;
      this.logger.error(`Failed to start Telegram long polling: ${err.message}`, err.stack);
    });
  }

  /**
   * Handles incoming webhook updates forwarded by TelegramController.
   * Ensures bot.init() has been called before processing.
   */
  async handleWebhookUpdate(update: Update): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized');
    }

    // Ensure bot.init() completed (retries lazily if startup init failed)
    await this.ensureBotInitialized();
    await this.bot.handleUpdate(update);
  }

  /**
   * Send notification or alert directly from backend services to a player's Telegram chat
   */
  async sendNotification(
    chatId: string | number,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'HTML',
  ): Promise<boolean> {
    if (!this.bot) {
      this.logger.warn(
        `Cannot send Telegram message: Bot is not configured. (chatId: ${chatId})`,
      );
      return false;
    }

    try {
      await this.ensureBotInitialized();
      await this.bot.api.sendMessage(chatId, text, { parse_mode: parseMode });
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send Telegram message to ${chatId}: ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Expose Bot instance if needed for advanced Telegram Bot API operations
   */
  getBotInstance(): Bot | null {
    return this.bot;
  }

  /**
   * Status reporting for health endpoint
   */
  getStatus(): {
    configured: boolean;
    initialized: boolean;
    mode: TelegramBotMode;
  } {
    return {
      configured: this.bot !== null,
      initialized: this.bot?.isInited() ?? false,
      mode: this.mode,
    };
  }
}
