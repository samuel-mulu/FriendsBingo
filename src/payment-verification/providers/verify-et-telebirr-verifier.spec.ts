import { PaymentProvider } from '@prisma/client';
import { VerifyEtTelebirrVerifier } from './verify-et-telebirr-verifier';

describe('VerifyEtTelebirrVerifier', () => {
  const originalFetch = global.fetch;

  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        VERIFY_ET_API_KEY: 'verify-et-test-key',
        VERIFY_ET_BASE_URL: 'https://verify.et',
        VERIFY_ET_WAIT_MS: '5000',
        VERIFY_ET_POLL_ATTEMPTS: '3',
        VERIFY_ET_POLL_INTERVAL_MS: '0',
        TELEBIRR_SETTLEMENT_ACCOUNT: '0962520885',
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

  it('maps a completed Verify.ET POST 200 response to VERIFIED', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          requestId: 'verify-et-req-1',
          processingStatus: 'completed',
          verified: true,
          data: [
            {
              verified: true,
              status: 'success',
              amount: '100.00',
              currency: 'ETB',
              settlementAccount: '0962520885',
              settlementAccountMatch: { matched: true },
              payerName: 'Mock Player',
              transactionNumber: 'TB123456',
            },
          ],
        }),
      ),
    } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const result = await verifier.verify({
      depositId: 'deposit-1',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'TB123456',
      requestedAmount: '100',
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.code).toBe('APPROVED');
    expect(result.requestId).toBe('verify-et-req-1');
    expect(result.verificationSource).toBe('verify.et');
  });

  it('maps a POST 200 completed response with nested verification metadata to VERIFIED', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          requestId: 'verify-et-req-post-completed',
          verification: {
            processingStatus: 'completed',
            verified: true,
          },
          data: [
            {
              verified: true,
              amount: '10',
              settlementAccountMatch: { matched: true },
              transactionNumber: 'DFF7WNHH5N',
            },
          ],
        }),
      ),
    } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const result = await verifier.verify({
      depositId: 'deposit-post-completed',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'DFF7WNHH5N',
      requestedAmount: '10',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('VERIFIED');
    expect(result.code).toBe('APPROVED');
    expect(result.code).not.toBe('VERIFICATION_UNAVAILABLE');
  });

  it('polls a 202 queued submit until GET status completes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 202,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-req-queued',
            processingStatus: 'queued',
          }),
        ),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-req-queued',
            processingStatus: 'completed',
            verified: true,
            data: [
              {
                verified: true,
                status: 'success',
                amount: '100.00',
                currency: 'ETB',
                settlementAccount: '0962520885',
                settlementAccountMatch: { matched: true },
                transactionNumber: 'TB123456',
              },
            ],
          }),
        ),
      } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const verificationPromise = verifier.verify({
      depositId: 'deposit-2',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'TB123456',
      requestedAmount: '100',
    });

    await jest.runAllTimersAsync();
    const result = await verificationPromise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('VERIFIED');
    expect(result.code).toBe('APPROVED');
    expect(result.code).not.toBe('VERIFICATION_UNAVAILABLE');
  });

  it('maps a dashboard-style GET status response with data object to VERIFIED', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 202,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-dashboard',
            processingStatus: 'queued',
          }),
        ),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-dashboard',
            data: {
              processingStatus: 'completed',
              status: 'success',
              verified: true,
              amount: '10',
              currency: 'ETB',
              settlementAccountMatch: { matched: true },
              transactionNumber: 'DFF7WNHH5N',
            },
          }),
        ),
      } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const verificationPromise = verifier.verify({
      depositId: 'deposit-dashboard',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'DFF7WNHH5N',
      requestedAmount: '10',
    });

    await jest.runAllTimersAsync();
    const result = await verificationPromise;

    expect(result.status).toBe('VERIFIED');
    expect(result.code).toBe('APPROVED');
    expect(result.code).not.toBe('VERIFICATION_UNAVAILABLE');
    expect(result.amount).toBe('10');
  });

  it('merges POST submit fields when GET status omits amount and settlement match', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 202,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-merge',
            processingStatus: 'queued',
            data: [
              {
                verified: true,
                status: 'success',
                amount: '10',
                settlementAccountMatch: { matched: true },
                transactionNumber: 'DFF7WNHH5N',
              },
            ],
          }),
        ),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-merge',
            data: {
              processingStatus: 'completed',
              status: 'success',
              verified: true,
              transactionNumber: 'DFF7WNHH5N',
            },
          }),
        ),
      } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const verificationPromise = verifier.verify({
      depositId: 'deposit-merge',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'DFF7WNHH5N',
      requestedAmount: '10',
    });

    await jest.runAllTimersAsync();
    const result = await verificationPromise;

    expect(result.status).toBe('VERIFIED');
    expect(result.code).toBe('APPROVED');
    expect(result.code).not.toBe('VERIFICATION_UNAVAILABLE');
  });

  it('returns VERIFICATION_UNAVAILABLE only when polling times out', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 202,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-timeout',
            processingStatus: 'queued',
          }),
        ),
      } as never)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            requestId: 'verify-et-timeout',
            data: {
              processingStatus: 'queued',
              verified: false,
            },
          }),
        ),
      } as never);

    const verifier = new VerifyEtTelebirrVerifier(configService as never);
    const verificationPromise = verifier.verify({
      depositId: 'deposit-timeout',
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'TB999999',
      requestedAmount: '10',
    });

    await jest.runAllTimersAsync();
    const result = await verificationPromise;

    expect(result.code).toBe('VERIFICATION_UNAVAILABLE');
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
