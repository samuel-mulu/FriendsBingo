import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentVerificationModule } from '../payment-verification/payment-verification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { DepositVerificationLockService } from './deposit-verification-lock.service';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    WalletModule,
    PaymentVerificationModule,
    RealtimeModule,
  ],
  controllers: [DepositsController],
  providers: [DepositsService, DepositVerificationLockService],
  exports: [DepositsService],
})
export class DepositsModule {}
