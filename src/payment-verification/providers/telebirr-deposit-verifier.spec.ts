import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentProvider } from '@prisma/client';
import { TelebirrDepositVerifier } from './telebirr-deposit-verifier';

describe('TelebirrDepositVerifier receipt page', () => {
  const validFixture = readFileSync(
    join(__dirname, 'fixtures', 'telebirr-receipt-valid.fixture.html'),
    'utf8',
  );

  it('verifies a parsed Telebirr receipt page', async () => {
    const fetcher = {
      buildReceiptUrl: (code: string) =>
        `https://transactioninfo.ethiotelecom.et/receipt/${code}`,
      fetchReceiptHtml: jest.fn().mockResolvedValue(validFixture),
    };
    const verifier = new TelebirrDepositVerifier(fetcher as never);

    const result = await verifier.verify({
      depositId: 'deposit-1',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'DFE8V9NO7E',
      requestedAmount: '100',
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.amount).toBe('100.00');
    expect(result.receiverAccount).toBe('0911002200');
    expect(result.raw).toEqual(
      expect.objectContaining({
        receiptUrl: 'https://transactioninfo.ethiotelecom.et/receipt/DFE8V9NO7E',
      }),
    );
  });
});
