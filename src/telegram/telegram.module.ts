import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramNotifierService } from './telegram-notifier.service';

@Module({
  imports: [ConfigModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramNotifierService],
  exports: [TelegramService, TelegramNotifierService],
})
export class TelegramModule {}
