import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';

interface MockDepositTransactionRecord {
  provider: PaymentProvider;
  transactionRef: string;
  amount: string;
  currency?: string;
  receiverAccount?: string;
  receiverName?: string;
  payerName?: string;
  payerAccount?: string;
  status: string;
  paidAt?: string;
}

@Injectable()
export class MockDepositTransactionService {
  private readonly records: MockDepositTransactionRecord[];

  constructor(private readonly configService: ConfigService) {
    this.records = this.loadRecords();
  }

  findByProviderAndReference(
    provider: PaymentProvider,
    transactionRef: string,
  ): MockDepositTransactionRecord | null {
    const normalizedRef = transactionRef.trim().toUpperCase();
    const matchedRecord = this.records.find(
      (record) =>
        record.provider === provider &&
        record.transactionRef.trim().toUpperCase() === normalizedRef,
    );

    if (!matchedRecord) {
      return null;
    }

    return this.resolvePlaceholders(matchedRecord);
  }

  private loadRecords(): MockDepositTransactionRecord[] {
    const candidatePaths = [
      path.resolve(
        process.cwd(),
        'dist',
        'payment-verification',
        'mock',
        'mock-deposit-transactions.json',
      ),
      path.resolve(
        process.cwd(),
        'src',
        'payment-verification',
        'mock',
        'mock-deposit-transactions.json',
      ),
    ];

    const filePath = candidatePaths.find((candidatePath) =>
      fs.existsSync(candidatePath),
    );

    if (!filePath) {
      return [];
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent) as MockDepositTransactionRecord[];
  }

  private resolvePlaceholders(
    record: MockDepositTransactionRecord,
  ): MockDepositTransactionRecord {
    return {
      ...record,
      receiverAccount: this.resolveReceiverAccountPlaceholder(
        record.provider,
        record.receiverAccount,
      ),
      receiverName: this.resolveReceiverNamePlaceholder(
        record.provider,
        record.receiverName,
      ),
    };
  }

  private resolveReceiverAccountPlaceholder(
    provider: PaymentProvider,
    receiverAccount?: string,
  ) {
    if (!receiverAccount) {
      return receiverAccount;
    }

    if (receiverAccount === 'YOUR_CBE_ACCOUNT_NUMBER') {
      return (
        this.configService.get<string>('CBE_ACCOUNT_NUMBER') ?? receiverAccount
      );
    }

    if (receiverAccount === 'YOUR_TELEBIRR_RECEIVER_PHONE') {
      return (
        this.configService.get<string>('TELEBIRR_RECEIVER_PHONE') ??
        receiverAccount
      );
    }

    if (provider === PaymentProvider.CBE) {
      return receiverAccount;
    }

    return receiverAccount;
  }

  private resolveReceiverNamePlaceholder(
    provider: PaymentProvider,
    receiverName?: string,
  ) {
    if (!receiverName || receiverName !== 'Friends Bingo') {
      return receiverName;
    }

    if (provider === PaymentProvider.CBE) {
      return (
        this.configService.get<string>('CBE_RECEIVER_NAME') ?? receiverName
      );
    }

    return (
      this.configService.get<string>('TELEBIRR_RECEIVER_NAME') ?? receiverName
    );
  }
}
