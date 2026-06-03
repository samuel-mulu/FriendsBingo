import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { DepositVerificationProvider } from '../interfaces/deposit-verification-provider.interface';
import { MockDepositTransactionService } from '../mock/mock-deposit-transaction.service';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';

@Injectable()
export class CbeDepositVerifier implements DepositVerificationProvider {
  readonly provider = PaymentProvider.CBE;

  constructor(
    private readonly mockDepositTransactionService: MockDepositTransactionService,
  ) {}

  async verify(input: VerifyDepositInput): Promise<DepositVerificationResult> {
    const matchedTransaction =
      this.mockDepositTransactionService.findByProviderAndReference(
        this.provider,
        input.transactionRef,
      );

    if (!matchedTransaction) {
      return {
        verified: false,
        status: 'MANUAL_REVIEW',
        provider: this.provider,
        transactionRef: input.transactionRef,
        reason: 'Transaction reference was not found in mock CBE verification data',
      };
    }

    if (matchedTransaction.status.trim().toUpperCase() !== 'SUCCESS') {
      return {
        verified: false,
        status: 'INVALID',
        provider: this.provider,
        transactionRef: matchedTransaction.transactionRef,
        amount: matchedTransaction.amount,
        currency: matchedTransaction.currency,
        payerName: matchedTransaction.payerName,
        payerAccount: matchedTransaction.payerAccount,
        receiverName: matchedTransaction.receiverName,
        receiverAccount: matchedTransaction.receiverAccount,
        paidAt: matchedTransaction.paidAt
          ? new Date(matchedTransaction.paidAt)
          : undefined,
        raw: matchedTransaction,
        reason: 'Mock CBE transaction is not successful',
      };
    }

    return {
      verified: true,
      status: 'VERIFIED',
      provider: this.provider,
      transactionRef: matchedTransaction.transactionRef,
      amount: matchedTransaction.amount,
      currency: matchedTransaction.currency,
      payerName: matchedTransaction.payerName,
      payerAccount: matchedTransaction.payerAccount,
      receiverName: matchedTransaction.receiverName,
      receiverAccount: matchedTransaction.receiverAccount,
      paidAt: matchedTransaction.paidAt
        ? new Date(matchedTransaction.paidAt)
        : undefined,
      raw: {
        source: 'mock-json',
        matchedTransaction,
        todo: [
          'Plug in cbe-verifier or ethiobank-receipts integration',
          'Replace mock JSON lookup with provider SDK or parser',
        ],
      },
    };
  }
}
