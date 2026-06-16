import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockDepositTransactionService } from './mock/mock-deposit-transaction.service';
import { CbeDepositVerifier } from './providers/cbe-deposit-verifier';
import { VerifyEtTelebirrVerifier } from './providers/verify-et-telebirr-verifier';
import { PaymentVerificationService } from './payment-verification.service';

@Module({
  imports: [ConfigModule],
  providers: [
    PaymentVerificationService,
    MockDepositTransactionService,
    CbeDepositVerifier,
    VerifyEtTelebirrVerifier,
  ],
  exports: [PaymentVerificationService],
})
export class PaymentVerificationModule {}
