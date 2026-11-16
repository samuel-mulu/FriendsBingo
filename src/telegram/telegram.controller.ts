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
  @ApiOperation({ summary: 'Telegram bot webhook update receiver' })
  async handleWebhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ): Promise<{ ok: boolean }> {
    const configuredSecret = this.configService.get<string>(
      TELEGRAM_WEBHOOK_SECRET_KEY,
    );

    if (configuredSecret && configuredSecret.trim().length > 0) {
      if (secretHeader !== configuredSecret.trim()) {
        this.logger.warn('Unauthorized webhook request: secret token mismatch');
        throw new UnauthorizedException('Invalid Telegram webhook secret');
      }
    }

    try {
      await this.telegramService.handleWebhookUpdate(update);
    } catch (err: any) {
      this.logger.error(`Error processing webhook update: ${err?.message}`, err?.stack);
      // Return ok: true so Telegram does not indefinitely retry errored updates
    }

    return { ok: true };
  }

  @Get('health')
  @ApiOperation({ summary: 'Telegram service health status' })
  health(): { status: string; configured: boolean } {
    const bot = this.telegramService.getBotInstance();
    return {
      status: 'ok',
      configured: bot !== null,
    };
  }
}
