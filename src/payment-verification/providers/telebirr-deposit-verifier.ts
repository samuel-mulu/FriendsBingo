import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { DepositVerificationProvider } from '../interfaces/deposit-verification-provider.interface';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';
import { TelebirrReceiptFetcher } from './telebirr-receipt.fetcher';
import {
  hasParseableReceiverFields,
  parseTelebirrReceiptHtml,
} from './telebirr-receipt.parser';

@Injectable()
export class TelebirrDepositVerifier implements DepositVerificationProvider {
  readonly provider = PaymentProvider.TELEBIRR;

  constructor(private readonly telebirrReceiptFetcher: TelebirrReceiptFetcher) {}

  async verify(input: VerifyDepositInput): Promise<DepositVerificationResult> {
    return this.verifyWithReceiptPage(input);
  }

  private async verifyWithReceiptPage(
    input: VerifyDepositInput,
  ): Promise<DepositVerificationResult> {
    const receiptUrl = this.telebirrReceiptFetcher.buildReceiptUrl(
      input.transactionRef,
    );
    const html = await this.telebirrReceiptFetcher.fetchReceiptHtml(
      input.transactionRef,
    );

    if (!html) {
      return {
        verified: false,
        status: 'INVALID',
        provider: this.provider,
        transactionRef: input.transactionRef,
        reason: 'Receipt could not be verified',
        raw: { receiptUrl, source: 'telebirr-receipt-page' },
      };
    }

    const parsed = parseTelebirrReceiptHtml(html, input.transactionRef);
    if (!parsed) {
      return {
        verified: false,
        status: 'INVALID',
        provider: this.provider,
        transactionRef: input.transactionRef,
        reason: 'Receipt could not be verified',
        raw: { receiptUrl, source: 'telebirr-receipt-page' },
      };
    }

    if (!hasParseableReceiverFields(parsed)) {
      return {
        verified: false,
        status: 'INVALID',
        provider: this.provider,
        transactionRef: parsed.invoiceNo,
        amount: parsed.amount,
        currency: parsed.currency,
        payerName: parsed.payerName,
        payerAccount: parsed.payerAccount,
        receiverName: parsed.receiverName,
        receiverAccount: parsed.receiverAccount,
        paidAt: parsed.paidAt,
        reason: 'Receiver details could not be confirmed from the receipt',
        raw: { receiptUrl, source: 'telebirr-receipt-page', parsed },
      };
    }

    return {
      verified: true,
      status: 'VERIFIED',
      provider: this.provider,
      transactionRef: parsed.invoiceNo,
      amount: parsed.amount,
      currency: parsed.currency,
      payerName: parsed.payerName,
      payerAccount: parsed.payerAccount,
      receiverName: parsed.receiverName,
      receiverAccount: parsed.receiverAccount,
      paidAt: parsed.paidAt,
      raw: { receiptUrl, source: 'telebirr-receipt-page', parsed },
    };
  }
}
