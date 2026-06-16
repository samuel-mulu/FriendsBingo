import { Prisma } from '@prisma/client';
import { TelebirrClientReceiptDto } from './dto/telebirr-client-receipt.dto';

export type TelebirrClientGateFailureCode =
  | 'AMOUNT_MISMATCH'
  | 'RECEIVER_MISMATCH'
  | 'INVALID_RECEIPT';

export interface TelebirrClientGateConfig {
  transactionRef: string;
  submittedAmount: string;
  settlementAccount: string;
  receiverPhone: string;
  receiverPhoneLast4?: string;
  receiverName: string;
}

export function validateTelebirrClientReceipt(
  clientReceipt: TelebirrClientReceiptDto,
  config: TelebirrClientGateConfig,
): TelebirrClientGateFailureCode | null {
  const normalizedTransactionRef = normalizeCode(config.transactionRef);
  const normalizedInvoice = normalizeCode(clientReceipt.invoiceNumber);

  if (
    !normalizedInvoice ||
    !normalizedInvoice.includes(normalizedTransactionRef)
  ) {
    return 'INVALID_RECEIPT';
  }

  const normalizedStatus = normalizeText(clientReceipt.transactionStatus);
  if (normalizedStatus !== 'completed') {
    return 'INVALID_RECEIPT';
  }

  const settledAmount = cleanMoney(clientReceipt.settledAmount);
  if (!settledAmount || !amountMatches(settledAmount, config.submittedAmount)) {
    return 'AMOUNT_MISMATCH';
  }

  const configuredLast4 = resolveReceiverLast4(
    config.receiverPhoneLast4,
    config.settlementAccount,
    config.receiverPhone,
  );
  const receiverLast4 = digitsOnly(clientReceipt.creditedPartyAccountNo);
  const last4Matches =
    configuredLast4.length > 0 &&
    receiverLast4.length >= 4 &&
    receiverLast4.endsWith(configuredLast4);

  const configuredName = config.receiverName.trim();
  const nameMatches =
    configuredName.length === 0 ||
    normalizeText(clientReceipt.creditedPartyName) ===
      normalizeText(configuredName);

  if (!last4Matches || !nameMatches) {
    return 'RECEIVER_MISMATCH';
  }

  return null;
}

function resolveReceiverLast4(
  explicitLast4: string | undefined,
  settlementAccount: string,
  receiverPhone: string,
): string {
  const fromExplicit = digitsOnly(explicitLast4 ?? '').slice(-4);
  if (fromExplicit.length === 4) {
    return fromExplicit;
  }

  const fromSettlement = digitsOnly(settlementAccount).slice(-4);
  if (fromSettlement.length === 4) {
    return fromSettlement;
  }

  return digitsOnly(receiverPhone).slice(-4);
}

function amountMatches(settledAmount: string, submittedAmount: string): boolean {
  try {
    return new Prisma.Decimal(settledAmount).equals(
      new Prisma.Decimal(submittedAmount),
    );
  } catch {
    return false;
  }
}

function cleanMoney(raw: string): string | null {
  const match = raw.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  return match?.[0] ?? null;
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
