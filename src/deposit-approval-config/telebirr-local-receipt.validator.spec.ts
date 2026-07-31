import { Prisma } from '@prisma/client';
import { TelebirrReceiptParseStatus } from '../deposits/dto/telebirr-receipt-parse-status.enum';
import {
  TelebirrLocalValidationInput,
  validateTelebirrLocalReceipt,
} from './telebirr-local-receipt.validator';

describe('validateTelebirrLocalReceipt', () => {
  const telebirrAccounts = [
    {
      settlementAccount: '0952723287',
      receiverName: 'Yonas shiferaw yowhans',
      receiverPhoneLast4: '3287',
    },
    {
      settlementAccount: '0961355799',
      receiverName: 'bisrat teklay gebreslassie',
      receiverPhoneLast4: '5799',
    },
  ];

  function buildInput(
    overrides: Partial<TelebirrLocalValidationInput> = {},
  ): TelebirrLocalValidationInput {
    return {
      transactionRef: 'DGS1BJ2WJ3',
      amount: new Prisma.Decimal('10'),
      receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
      clientReceipt: {
        invoiceNumber: 'DGS1BJ2WJ3',
        transactionStatus: 'Completed',
        settledAmount: '10',
        creditedPartyName: 'Yonas Shiferaw Yowhans',
        creditedPartyAccountNo: '2519****3287',
      },
      telebirrAccounts,
      ...overrides,
    };
  }

  it('approves a receipt whose receiver name is spelled differently', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({
        clientReceipt: {
          invoiceNumber: 'DGS1BJ2WJ3',
          transactionStatus: 'Completed',
          settledAmount: '10',
          creditedPartyName: 'Yonas Shiferaw Yohanes',
          creditedPartyAccountNo: '2519****3287',
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verifiedAmount.toString()).toBe('10');
      expect(result.verifiedReceiverName).toBe('Yonas Shiferaw Yohanes');
    }
  });

  it('approves a receipt paid to the second configured account', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({
        clientReceipt: {
          invoiceNumber: 'DGS1BJ2WJ3',
          transactionStatus: 'Completed',
          settledAmount: '10',
          creditedPartyName: 'Bisrat Teklay Gebresilassie',
          creditedPartyAccountNo: '2519****5799',
        },
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('derives the last4 from the settlement account when not configured', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({
        telebirrAccounts: [
          {
            settlementAccount: '0952723287',
            receiverName: '',
            receiverPhoneLast4: '',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a receipt paid to an unknown phone number', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({
        clientReceipt: {
          invoiceNumber: 'DGS1BJ2WJ3',
          transactionStatus: 'Completed',
          settledAmount: '10',
          creditedPartyName: 'Yonas Shiferaw Yowhans',
          creditedPartyAccountNo: '2519****1111',
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'SETTLEMENT_MISMATCH' });
  });

  it('rejects when the settled amount differs from the requested amount', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({ amount: new Prisma.Decimal('10.16') }),
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'AMOUNT_MISMATCH' });
  });

  it('reports a verification outage when no receipt could be parsed', () => {
    expect(
      validateTelebirrLocalReceipt(
        buildInput({
          receiptParseStatus: TelebirrReceiptParseStatus.UNAVAILABLE,
          clientReceipt: undefined,
        }),
      ),
    ).toMatchObject({ ok: false, errorCode: 'VERIFICATION_UNAVAILABLE' });

    expect(
      validateTelebirrLocalReceipt(buildInput({ clientReceipt: undefined })),
    ).toMatchObject({ ok: false, errorCode: 'VERIFICATION_UNAVAILABLE' });
  });

  it('rejects a receipt that is not completed', () => {
    const result = validateTelebirrLocalReceipt(
      buildInput({
        clientReceipt: {
          invoiceNumber: 'DGS1BJ2WJ3',
          transactionStatus: 'Pending',
          settledAmount: '10',
          creditedPartyName: 'Yonas Shiferaw Yowhans',
          creditedPartyAccountNo: '2519****3287',
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'INVALID_RECEIPT' });
  });
});
