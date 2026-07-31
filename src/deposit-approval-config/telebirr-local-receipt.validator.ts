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
  // No clientReceipt means the mobile app could not read the Telebirr receipt
  // URL. Local mode never fetches that URL on the server.
  if (
    input.receiptParseStatus !== TelebirrReceiptParseStatus.PARSED ||
    !input.clientReceipt
  ) {
    return {
      ok: false,
      errorCode: 'VERIFICATION_UNAVAILABLE',
      message: DEPOSIT_ERROR_MESSAGES.VERIFICATION_UNAVAILABLE,
    };
  }

  const clientReceipt = input.clientReceipt;

  if (normalizeText(clientReceipt.transactionStatus) !== 'completed') {
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

/**
 * The masked account number is the only stable identifier on a Telebirr
 * receipt. Receiver names are free text and vary in spelling, so they are only
 * compared when no last4 is configured for the account.
 */
function accountReceiverMatches(
  account: TelebirrLocalValidationInput['telebirrAccounts'][number],
  receiverName: string,
  receiverAccount: string,
): boolean {
  const configuredLast4 = resolveConfiguredLast4(account);
  if (configuredLast4) {
    const receiverLast4 = digitsOnly(receiverAccount);
    return receiverLast4.length >= 4 && receiverLast4.endsWith(configuredLast4);
  }

  const configuredName = normalizeText(account.receiverName);
  if (configuredName.length === 0) {
    return false;
  }

  return normalizeText(receiverName) === configuredName;
}

function resolveConfiguredLast4(
  account: TelebirrLocalValidationInput['telebirrAccounts'][number],
): string | null {
  for (const candidate of [
    account.receiverPhoneLast4,
    account.settlementAccount,
  ]) {
    const digits = digitsOnly(candidate ?? '');
    if (digits.length >= 4) {
      return digits.slice(-4);
    }
  }

  return null;
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
