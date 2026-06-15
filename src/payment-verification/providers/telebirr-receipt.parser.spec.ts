import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasParseableReceiverFields,
  parseTelebirrReceiptHtml,
} from './telebirr-receipt.parser';

describe('parseTelebirrReceiptHtml', () => {
  const validFixture = readFileSync(
    join(__dirname, 'fixtures', 'telebirr-receipt-valid.fixture.html'),
    'utf8',
  );
  const invalidFixture = readFileSync(
    join(__dirname, 'fixtures', 'telebirr-receipt-invalid.fixture.html'),
    'utf8',
  );
  const realFixture = readFileSync(
    join(__dirname, 'fixtures', 'telebirr-receipt-dff3wlqb6r.fixture.html'),
    'utf8',
  );

  it('parses a valid Telebirr receipt fixture', () => {
    const parsed = parseTelebirrReceiptHtml(validFixture, 'DFE8V9NO7E');

    expect(parsed).toEqual(
      expect.objectContaining({
        invoiceNo: 'DFE8V9NO7E',
        transactionStatus: 'Completed',
        settledAmount: '100.00',
        amount: '100.00',
        currency: 'ETB',
        creditedPartyName: 'Friends Bingo',
        creditedPartyAccountNo: '0911002200',
        receiverName: 'Friends Bingo',
        receiverAccount: '0911002200',
      }),
    );
    expect(parsed?.paidAt).toBeInstanceOf(Date);
    expect(hasParseableReceiverFields(parsed!)).toBe(true);
  });

  it('parses the real DFF3WLQB6R receipt layout', () => {
    const parsed = parseTelebirrReceiptHtml(realFixture, 'DFF3WLQB6R');

    expect(parsed).toEqual(
      expect.objectContaining({
        invoiceNo: 'DFF3WLQB6R',
        paymentDate: '15-06-2026 16:41:58',
        settledAmount: '30.00',
        amount: '30.00',
        totalPaidAmount: '31.00',
        serviceFee: '0.87',
        serviceFeeVat: '0.13',
        stampDuty: '0.00',
        discountAmount: '0.00',
        payerName: 'Fikadu Taye Shume',
        payerTelebirrNo: '2519****4548',
        creditedPartyName: 'Samueal Mulu Gebremedhin',
        creditedPartyAccountNo: '2519****0885',
        transactionStatus: 'Completed',
      }),
    );
    expect(parsed?.receiverName).toBe('Samueal Mulu Gebremedhin');
    expect(parsed?.receiverAccount).toBe('2519****0885');
    expect(parsed?.receiverName).not.toContain('Credited party account no');
    expect(hasParseableReceiverFields(parsed!)).toBe(true);
  });

  it('uses settled amount when total paid includes payer fees', () => {
    const feesFixture = readFileSync(
      join(__dirname, 'fixtures', 'telebirr-receipt-fees.fixture.html'),
      'utf8',
    );

    const parsed = parseTelebirrReceiptHtml(feesFixture, 'DFF9WK0K11');

    expect(parsed).toEqual(
      expect.objectContaining({
        invoiceNo: 'DFF9WK0K11',
        settledAmount: '50.00',
        amount: '50.00',
        totalPaidAmount: '51.00',
      }),
    );
  });

  it('returns null for invalid short receipt pages', () => {
    expect(parseTelebirrReceiptHtml(invalidFixture, 'DFE8V9NO7E')).toBeNull();
  });

  it('returns null when invoice code does not match expected reference', () => {
    expect(parseTelebirrReceiptHtml(validFixture, 'OTHERCODE1')).toBeNull();
  });

  it('returns null when transaction status is not Completed', () => {
    const failedHtml = validFixture.replace('Completed', 'Failed');
    expect(parseTelebirrReceiptHtml(failedHtml, 'DFE8V9NO7E')).toBeNull();
  });
});
