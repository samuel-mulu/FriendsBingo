import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VerifyEtModule } from '../verify-et/verify-et.module';
import { WalletModule } from '../wallet/wallet.module';
import { DepositApprovalConfigModule } from '../deposit-approval-config/deposit-approval-config.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuthModule,
    WalletModule,
    VerifyEtModule,
    RealtimeModule,
    NotificationsModule,
    DepositApprovalConfigModule,
  ],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
