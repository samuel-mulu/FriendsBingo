import { PaymentProvider } from '@prisma/client';
import { MockDepositTransactionService } from '../mock/mock-deposit-transaction.service';
import { CbeDepositVerifier } from './cbe-deposit-verifier';

describe('Mock deposit verifiers', () => {
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | boolean> = {
        NODE_ENV: 'test',
        PAYMENT_MOCK_VERIFICATION_ALLOWED: false,
        CBE_ACCOUNT_NUMBER: '1002003004005006',
        CBE_RECEIVER_NAME: 'Friends Bingo',
      };

      return values[key];
    }),
  };

  it('verifies a mock CBE deposit', async () => {
    const mockService = new MockDepositTransactionService(
      configService as never,
    );
    const verifier = new CbeDepositVerifier(mockService, configService as never);

    const result = await verifier.verify({
      depositId: 'deposit-1',
      provider: PaymentProvider.CBE,
      transactionRef: 'FTMOCK100',
      requestedAmount: '100',
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.verified).toBe(true);
    expect(result.receiverAccount).toBe('1002003004005006');
  });

  it('does not auto-verify mock CBE deposits in production', async () => {
    const productionConfig = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') {
          return 'production';
        }

        if (key === 'PAYMENT_MOCK_VERIFICATION_ALLOWED') {
          return false;
        }

        return undefined;
      }),
    };
    const mockService = new MockDepositTransactionService(
      configService as never,
    );
    const verifier = new CbeDepositVerifier(
      mockService,
      productionConfig as never,
    );

    const result = await verifier.verify({
      depositId: 'deposit-prod',
      provider: PaymentProvider.CBE,
      transactionRef: 'FTMOCK100',
      requestedAmount: '100',
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe('MANUAL_REVIEW');
  });

  it('moves unknown mock transactions to manual review', async () => {
    const mockService = new MockDepositTransactionService(
      configService as never,
    );
    const verifier = new CbeDepositVerifier(mockService, configService as never);

    const result = await verifier.verify({
      depositId: 'deposit-3',
      provider: PaymentProvider.CBE,
      transactionRef: 'UNKNOWN-MOCK-REF',
      requestedAmount: '100',
    });

    expect(result.status).toBe('MANUAL_REVIEW');
    expect(result.verified).toBe(false);
  });
});
