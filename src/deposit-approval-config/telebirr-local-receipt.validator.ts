import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TelebirrClientReceiptDto } from '../deposits/dto/telebirr-client-receipt.dto';
import { TelebirrReceiptParseStatus } from '../deposits/dto/telebirr-receipt-parse-status.enum';
import {
  DEPOSIT_ERROR_MESSAGES,
  DepositErrorCode,
} from '../deposits/deposit-verification.errors';

export interface TelebirrLocalValidationInput {
  transactionRef: string;
  amount: Prisma.Decimal;
  receiptParseStatus?: TelebirrReceiptParseStatus;
  clientReceipt?: TelebirrClientReceiptDto;
  telebirrAccounts: Array<{
    settlementAccount: string;
    receiverName: string;
    receiverPhoneLast4: string;
  }>;
}

export interface TelebirrLocalValidationResult {
  ok: true;
  verifiedAmount: Prisma.Decimal;
  verifiedReceiverName: string;
  clientReceipt: TelebirrClientReceiptDto;
}

export interface TelebirrLocalValidationFailure {
  ok: false;
  errorCode: DepositErrorCode;
  message: string;
}

export function validateTelebirrLocalReceipt(
  input: TelebirrLocalValidationInput,
): TelebirrLocalValidationResult | TelebirrLocalValidationFailure {
  if (input.receiptParseStatus !== TelebirrReceiptParseStatus.PARSED) {
    return {
      ok: false,
      errorCode: 'INVALID_RECEIPT',
      message: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
    };
  }

  const clientReceipt = input.clientReceipt;
  if (!clientReceipt) {
    return {
      ok: false,
      errorCode: 'INVALID_RECEIPT',
      message: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
    };
  }

  if (
    normalizeCode(clientReceipt.transactionStatus) !== 'completed'
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_RECEIPT',
      message: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
    };
  }

  if (
    !normalizeCode(clientReceipt.invoiceNumber).includes(
      normalizeCode(input.transactionRef),
    )
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_RECEIPT',
      message: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
    };
  }

  let settledAmount: Prisma.Decimal;
  try {
    settledAmount = new Prisma.Decimal(clientReceipt.settledAmount);
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_RECEIPT',
      message: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
    };
  }

  if (!settledAmount.equals(input.amount)) {
    return {
      ok: false,
      errorCode: 'AMOUNT_MISMATCH',
      message: DEPOSIT_ERROR_MESSAGES.AMOUNT_MISMATCH,
    };
  }

  if (
    !receiverMatches(
      input.telebirrAccounts,
      clientReceipt.creditedPartyName,
      clientReceipt.creditedPartyAccountNo,
    )
  ) {
    return {
      ok: false,
      errorCode: 'SETTLEMENT_MISMATCH',
      message: DEPOSIT_ERROR_MESSAGES.SETTLEMENT_MISMATCH,
    };
  }

  return {
    ok: true,
    verifiedAmount: settledAmount,
    verifiedReceiverName: clientReceipt.creditedPartyName.trim(),
    clientReceipt,
  };
}

export function assertTelebirrLocalReceipt(
  input: TelebirrLocalValidationInput,
): TelebirrLocalValidationResult {
  const result = validateTelebirrLocalReceipt(input);
  if (!result.ok) {
    throw new BadRequestException({
      message: result.message,
      code: result.errorCode,
    });
  }

  return result;
}

function receiverMatches(
  accounts: TelebirrLocalValidationInput['telebirrAccounts'],
  receiverName: string,
  receiverAccount: string,
): boolean {
  return accounts.some((account) =>
    accountReceiverMatches(account, receiverName, receiverAccount),
  );
}

function accountReceiverMatches(
  account: TelebirrLocalValidationInput['telebirrAccounts'][number],
  receiverName: string,
  receiverAccount: string,
): boolean {
  const configuredLast4 = digitsOnly(account.receiverPhoneLast4);
  const receiverLast4 = digitsOnly(receiverAccount);
  const last4Matches =
    configuredLast4.length > 0 &&
    receiverLast4.length >= 4 &&
    receiverLast4.endsWith(configuredLast4);
  const nameMatches =
    account.receiverName.trim().length === 0 ||
    normalizeText(receiverName) === normalizeText(account.receiverName);

  return last4Matches && nameMatches;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}
