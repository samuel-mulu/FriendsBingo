import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockDepositTransactionService } from './mock/mock-deposit-transaction.service';
import { CbeDepositVerifier } from './providers/cbe-deposit-verifier';
import { TelebirrDepositVerifier } from './providers/telebirr-deposit-verifier';
import { TelebirrReceiptFetcher } from './providers/telebirr-receipt.fetcher';
import { PaymentVerificationService } from './payment-verification.service';

@Module({
  imports: [ConfigModule],
  providers: [
    PaymentVerificationService,
    MockDepositTransactionService,
    CbeDepositVerifier,
    TelebirrReceiptFetcher,
    TelebirrDepositVerifier,
  ],
  exports: [PaymentVerificationService],
})
export class PaymentVerificationModule {}
