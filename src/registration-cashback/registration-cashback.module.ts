import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { RegistrationCashbackConfigService } from './registration-cashback-config.service';
import { RegistrationCashbackService } from './registration-cashback.service';

@Module({
  imports: [PrismaModule, WalletModule, RealtimeModule, NotificationsModule],
  providers: [RegistrationCashbackConfigService, RegistrationCashbackService],
  exports: [RegistrationCashbackConfigService, RegistrationCashbackService],
})
export class RegistrationCashbackModule {}
