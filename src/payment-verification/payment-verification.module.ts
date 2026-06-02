import { Module } from '@nestjs/common';
import { CbeDepositVerifier } from './providers/cbe-deposit-verifier';
import { TelebirrDepositVerifier } from './providers/telebirr-deposit-verifier';
import { PaymentVerificationService } from './payment-verification.service';

@Module({
  providers: [
    PaymentVerificationService,
    CbeDepositVerifier,
    TelebirrDepositVerifier,
  ],
  exports: [PaymentVerificationService],
})
export class PaymentVerificationModule {}
