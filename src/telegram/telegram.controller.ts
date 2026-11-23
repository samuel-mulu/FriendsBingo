import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { Update } from 'grammy/types';
import { TelegramService } from './telegram.service';
import { TELEGRAM_WEBHOOK_SECRET_KEY } from './telegram.constants';

@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({ summary: 'Telegram bot webhook update receiver' })
  async handleWebhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ): Promise<{ ok: boolean }> {
    const configuredSecret = this.configService.get<string>(
      TELEGRAM_WEBHOOK_SECRET_KEY,
    );

    // Fail-closed: in production, require a webhook secret when configured
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (
      nodeEnv === 'production' &&
      (!configuredSecret || configuredSecret.trim().length === 0)
    ) {
      this.logger.error(
        'TELEGRAM_WEBHOOK_SECRET is not configured in production. Rejecting webhook.',
      );
      throw new UnauthorizedException(
        'Webhook secret not configured in production',
      );
    }

    // Verify webhook secret using constant-time comparison
    if (configuredSecret && configuredSecret.trim().length > 0) {
      const secret = configuredSecret.trim();
      const received = secretHeader ?? '';

      if (
        received.length === 0 ||
        !constantTimeEqual(received, secret)
      ) {
        this.logger.warn(
          'Unauthorized webhook request: secret token mismatch',
        );
        throw new UnauthorizedException('Invalid Telegram webhook secret');
      }
    }

    // Verify bot is configured
    if (!this.telegramService.getBotInstance()) {
      this.logger.warn(
        'Webhook received but Telegram bot is not configured. Ignoring update.',
      );
      return { ok: true };
    }

    try {
      await this.telegramService.handleWebhookUpdate(update);
    } catch (err: any) {
      this.logger.error(
        `Error processing webhook update: ${err?.message}`,
        err?.stack,
      );
      // Return ok: true so Telegram does not indefinitely retry errored updates
    }

    return { ok: true };
  }

  @Get('health')
  @ApiOperation({ summary: 'Telegram service health status' })
  health(): {
    status: string;
    configured: boolean;
    initialized: boolean;
    mode: string;
  } {
    const botStatus = this.telegramService.getStatus();
    return {
      status: 'ok',
      ...botStatus,
    };
  }
}

/**
 * Constant-time string comparison to prevent timing attacks on webhook secret.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  if (aBuf.length !== bBuf.length) {
    // Perform a dummy comparison to prevent timing leaks on length difference
    timingSafeEqual(aBuf, aBuf);
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}
