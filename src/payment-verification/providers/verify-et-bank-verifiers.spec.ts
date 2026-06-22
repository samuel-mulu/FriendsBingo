import { PaymentProvider } from '@prisma/client';
import { AwashDepositVerifier } from './awash-deposit-verifier';
import { BoaDepositVerifier } from './boa-deposit-verifier';
import { CbeDepositVerifier } from './cbe-deposit-verifier';

describe('Verify.ET bank verifiers', () => {
  const originalFetch = global.fetch;

  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        VERIFY_ET_API_KEY: 'verify-et-test-key',
        VERIFY_ET_BASE_URL: 'https://verify.et',
        VERIFY_ET_WAIT_MS: '5000',
        VERIFY_ET_POLL_ATTEMPTS: '3',
        VERIFY_ET_POLL_INTERVAL_MS: '0',
        CBE_ACCOUNT_LAST8: '04005006',
        BOA_ACCOUNT_SUFFIX: '54321',
      };

      return values[key];
    }),
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('submits CBE verification with referenceNumber and 8-digit account suffix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          requestId: 'verify-et-cbe',
          processingStatus: 'completed',
          verified: true,
          data: [
            {
              verified: true,
              status: 'success',
              amount: '100.00',
              currency: 'ETB',
              receiverAccount: '1002003004005006',
              receiverName: 'Friends Bingo',
              referenceNumber: 'FT26152ZN0XY',
            },
          ],
        }),
      ),
    } as never);

    const verifier = new CbeDepositVerifier(configService as never);
    const result = await verifier.verify({
      depositId: 'deposit-cbe',
      provider: PaymentProvider.CBE,
      transactionRef: 'FT26152ZN0XY',
      requestedAmount: '100',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://verify.et/api/verify?waitMs=5000',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          bank: 'cbe',
          referenceNumber: 'FT26152ZN0XY',
          accountSuffix: '04005006',
        }),
      }),
    );
    expect(result.status).toBe('VERIFIED');
  });

  it('submits BOA verification with a 5-digit account suffix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          requestId: 'verify-et-boa',
          processingStatus: 'completed',
          verified: true,
          data: {
            verified: true,
            status: 'success',
            amount: '75',
            currency: 'ETB',
            receiverAccount: '987654321',
            referenceNumber: 'BOA123456',
          },
        }),
      ),
    } as never);

    const verifier = new BoaDepositVerifier(configService as never);
    const result = await verifier.verify({
      depositId: 'deposit-boa',
      provider: PaymentProvider.BOA,
      transactionRef: 'BOA123456',
      requestedAmount: '75',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://verify.et/api/verify?waitMs=5000',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          bank: 'boa',
          referenceNumber: 'BOA123456',
          accountSuffix: '54321',
        }),
      }),
    );
    expect(result.status).toBe('VERIFIED');
  });

  it('submits Awash verification with only referenceNumber', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          requestId: 'verify-et-awash',
          processingStatus: 'completed',
          verified: true,
          data: {
            verified: true,
            status: 'success',
            amount: '45',
            currency: 'ETB',
            receiverName: 'Friends Bingo',
            reference: 'AW12345678',
          },
        }),
      ),
    } as never);

    const verifier = new AwashDepositVerifier(configService as never);
    const result = await verifier.verify({
      depositId: 'deposit-awash',
      provider: PaymentProvider.AWASH,
      transactionRef: 'AW12345678',
      requestedAmount: '45',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://verify.et/api/verify?waitMs=5000',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          bank: 'awash',
          referenceNumber: 'AW12345678',
        }),
      }),
    );
    expect(result.transactionRef).toBe('AW12345678');
    expect(result.status).toBe('VERIFIED');
  });

  it('stops polling CBE as soon as Verify.ET returns terminal failed status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 202,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-cbe-failed',
            processingStatus: 'queued',
          }),
        ),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-cbe-failed',
            data: {
              processingStatus: 'failed',
              status: 'failed',
              verified: false,
              errorMessage:
                'The bank is not responding right now. Please try again shortly.',
            },
          }),
        ),
      } as never);

    const verifier = new CbeDepositVerifier(configService as never);
    const verificationPromise = verifier.verify({
      depositId: 'deposit-cbe-failed',
      provider: PaymentProvider.CBE,
      transactionRef: 'FT26152ZN0XY',
      requestedAmount: '100',
    });

    await jest.runAllTimersAsync();
    const result = await verificationPromise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ERROR');
    expect(result.code).toBe('VERIFICATION_UNAVAILABLE');
  });
});
