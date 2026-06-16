import { TelebirrClientReceiptDto } from './dto/telebirr-client-receipt.dto';
import {
  TelebirrClientGateConfig,
  validateTelebirrClientReceipt,
} from './telebirr-client-receipt.validator';

describe('validateTelebirrClientReceipt', () => {
  const baseReceipt: TelebirrClientReceiptDto = {
    invoiceNumber: 'DFF3WLQB6R',
    transactionStatus: 'Completed',
    settledAmount: '30.00',
    creditedPartyName: 'Samueal Mulu Gebremedhin',
    creditedPartyAccountNo: '2519****0885',
  };

  const baseConfig: TelebirrClientGateConfig = {
    transactionRef: 'DFF3WLQB6R',
    submittedAmount: '30',
    settlementAccount: '0962520885',
    receiverPhone: '0962520885',
    receiverPhoneLast4: '0885',
    receiverName: 'Samueal Mulu Gebremedhin',
  };

  it('passes valid parsed receipt data', () => {
    expect(validateTelebirrClientReceipt(baseReceipt, baseConfig)).toBeNull();
  });

  it('returns AMOUNT_MISMATCH when settled amount differs from submitted amount', () => {
    expect(
      validateTelebirrClientReceipt(baseReceipt, {
        ...baseConfig,
        submittedAmount: '31',
      }),
    ).toBe('AMOUNT_MISMATCH');
  });

  it('returns RECEIVER_MISMATCH when credited party account last4 differs', () => {
    expect(
      validateTelebirrClientReceipt(
        {
          ...baseReceipt,
          creditedPartyAccountNo: '2519****9999',
        },
        baseConfig,
      ),
    ).toBe('RECEIVER_MISMATCH');
  });

  it('returns RECEIVER_MISMATCH when credited party name differs', () => {
    expect(
      validateTelebirrClientReceipt(
        {
          ...baseReceipt,
          creditedPartyName: 'Wrong Receiver',
        },
        baseConfig,
      ),
    ).toBe('RECEIVER_MISMATCH');
  });

  it('returns INVALID_RECEIPT when invoice number does not match transaction ref', () => {
    expect(
      validateTelebirrClientReceipt(
        {
          ...baseReceipt,
          invoiceNumber: 'OTHER123',
        },
        baseConfig,
      ),
    ).toBe('INVALID_RECEIPT');
  });

  it('returns INVALID_RECEIPT when transaction status is not completed', () => {
    expect(
      validateTelebirrClientReceipt(
        {
          ...baseReceipt,
          transactionStatus: 'Pending',
        },
        baseConfig,
      ),
    ).toBe('INVALID_RECEIPT');
  });
});
