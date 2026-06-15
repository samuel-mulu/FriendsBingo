export interface ParsedTelebirrReceipt {
  invoiceNo: string;
  paymentDate?: string;
  settledAmount: string;
  stampDuty?: string;
  discountAmount?: string;
  serviceFee?: string;
  serviceFeeVat?: string;
  totalPaidAmount?: string;
  payerName?: string;
  payerTelebirrNo?: string;
  creditedPartyName?: string;
  creditedPartyAccountNo?: string;
  transactionStatus: string;
  currency: string;
  paidAt?: Date;
  /** Settled amount — amount credited to merchant wallet */
  amount: string;
  receiverName?: string;
  receiverAccount?: string;
  payerAccount?: string;
}

const MIN_VALID_RECEIPT_BYTES = 400;
const LABEL_VALUE_PATTERN =
  /([\d,]+(?:\.\d{1,2})?)\s*(?:Birr|ETB)?/i;

function cleanCellText(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const cleaned = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /\/(Payer|Credited|Invoice|Settled|Total|transaction)/i.test(cleaned)) {
    return undefined;
  }

  return cleaned;
}

function parseAmountBirr(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(LABEL_VALUE_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const normalized = match[1].replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed.toFixed(2);
}

function extractLabelRowValue(html: string, englishLabel: string): string | undefined {
  const pattern = new RegExp(
    `${englishLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?<\\/td>\\s*<td[^>]*>\\s*([^<]+?)(?:<\\/label>)?\\s*<\\/td>`,
    'i',
  );
  return cleanCellText(extractTableValue(html, pattern));
}

function extractTableValue(html: string, labelPattern: RegExp): string | undefined {
  const match = html.match(labelPattern);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].replace(/\s+/g, ' ').trim();
}

function extractTransactionStatus(html: string): string | undefined {
  const rowMatch = html.match(
    /transaction status[\s\S]*?<td[^>]*>\s*([^<]+?)\s*<\/td>/i,
  );
  return cleanCellText(rowMatch?.[1]);
}

function extractInvoiceDetailsRow(html: string): {
  invoiceNo?: string;
  paymentDate?: string;
  settledAmount?: string;
} {
  const rowMatch = html.match(
    /Invoice No\.[\s\S]*?<\/tr>\s*<tr>\s*<td[^>]*>\s*([A-Z0-9]{6,20})\s*<\/td>\s*<td[^>]*>\s*([\d-]+\s+[\d:]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
  );

  if (!rowMatch) {
    return {};
  }

  return {
    invoiceNo: rowMatch[1]?.trim().toUpperCase(),
    paymentDate: cleanCellText(rowMatch[2]),
    settledAmount: parseAmountBirr(rowMatch[3]),
  };
}

function extractFeeRow(html: string, englishLabel: string): string | undefined {
  const pattern = new RegExp(
    `${englishLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?<td[^>]*>\\s*([^<]+?)\\s*<\\/td>\\s*<\\/tr>`,
    'i',
  );
  return parseAmountBirr(extractTableValue(html, pattern));
}

function parsePaymentDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) {
    return undefined;
  }

  const [, day, month, year, hour, minute, second] = match;
  return new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10),
  );
}

function mapLegacyFields(parsed: Omit<ParsedTelebirrReceipt, 'amount' | 'receiverName' | 'receiverAccount' | 'payerAccount'>): ParsedTelebirrReceipt {
  return {
    ...parsed,
    amount: parsed.settledAmount,
    receiverName: parsed.creditedPartyName,
    receiverAccount: parsed.creditedPartyAccountNo,
    payerAccount: parsed.payerTelebirrNo,
  };
}

export function parseTelebirrReceiptHtml(
  html: string,
  expectedRef: string,
): ParsedTelebirrReceipt | null {
  if (html.length < MIN_VALID_RECEIPT_BYTES) {
    return null;
  }

  const transactionStatus = extractTransactionStatus(html);
  if (!transactionStatus || !/^completed$/i.test(transactionStatus)) {
    return null;
  }

  const invoiceRow = extractInvoiceDetailsRow(html);
  const invoiceNo = invoiceRow.invoiceNo;

  if (!invoiceNo || invoiceNo !== expectedRef.trim().toUpperCase()) {
    return null;
  }

  const settledAmount = invoiceRow.settledAmount;
  if (!settledAmount) {
    return null;
  }

  const creditedPartyName = extractLabelRowValue(html, 'Credited Party name');
  const creditedPartyAccountNo = extractLabelRowValue(
    html,
    'Credited party account no',
  );

  return mapLegacyFields({
    invoiceNo,
    paymentDate: invoiceRow.paymentDate,
    settledAmount,
    stampDuty: extractFeeRow(html, 'Stamp Duty'),
    discountAmount: extractFeeRow(html, 'Discount Amount'),
    serviceFee: extractFeeRow(html, 'Service fee'),
    serviceFeeVat: extractFeeRow(html, 'Service fee VAT'),
    totalPaidAmount: extractFeeRow(html, 'Total Paid Amount'),
    payerName: extractLabelRowValue(html, 'Payer Name'),
    payerTelebirrNo: extractLabelRowValue(html, 'Payer telebirr no'),
    creditedPartyName,
    creditedPartyAccountNo,
    transactionStatus,
    currency: 'ETB',
    paidAt: parsePaymentDate(invoiceRow.paymentDate),
  });
}

export function hasParseableReceiverFields(
  parsed: ParsedTelebirrReceipt,
): boolean {
  return Boolean(
    parsed.creditedPartyAccountNo?.trim() && parsed.creditedPartyName?.trim(),
  );
}
