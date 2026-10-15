import { ConfigService } from '@nestjs/config';
import {
  buildVerifyEtIdempotencyKey,
  VerifyEtClient,
} from './verify-et.client';

describe('VerifyEtClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createClient(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      VERIFY_ET_BASE_URL: 'https://verify.et',
      VERIFY_ET_WAIT_MS: '0',
      VERIFY_ET_POLL_ATTEMPTS: '2',
      VERIFY_ET_POLL_INTERVAL_MS: '1',
      VERIFY_ET_API_KEY: 'test-key',
      ...overrides,
    };

    const configService = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;

    return new VerifyEtClient(configService);
  }

  it('builds a stable idempotency key for the same seed and body', () => {
    const body = {
      bank: 'telebirr',
      transactionNumber: 'ABC123',
      settlementAccount: '111',
    };

    expect(buildVerifyEtIdempotencyKey('telebirr-ABC123', body)).toBe(
      buildVerifyEtIdempotencyKey('telebirr-ABC123', body),
    );
  });

  it('changes idempotency key when settlement account changes', () => {
    const seed = 'telebirr-ABC123';
    const key1 = buildVerifyEtIdempotencyKey(seed, {
      bank: 'telebirr',
      transactionNumber: 'ABC123',
      settlementAccount: '111',
    });
    const key2 = buildVerifyEtIdempotencyKey(seed, {
      bank: 'telebirr',
      transactionNumber: 'ABC123',
      settlementAccount: '222',
    });

    expect(key1).not.toBe(key2);
  });

  it('classifies poll exhaustion as unavailable with pending status', async () => {
    const client = createClient();
    let pollCalls = 0;

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/verify?')) {
        return new Response(
          JSON.stringify({
            requestId: 'req-1',
            processingStatus: 'processing',
            verified: false,
          }),
          { status: 202 },
        );
      }

      pollCalls += 1;
      return new Response(
        JSON.stringify({
          requestId: 'req-1',
          processingStatus: 'processing',
          verified: false,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await client.submitAndPoll(
      {
        bank: 'telebirr',
        transactionNumber: 'ABC123XYZ',
        settlementAccount: '0952723287',
      },
      'telebirr-ABC123XYZ',
      { correlationId: 'corr-1', provider: 'TELEBIRR' },
    );

    expect(pollCalls).toBe(2);
    expect(result.unavailable).toBe(true);
    expect(result.processingStatus).toBe('pending');
    expect(result.verified).toBe(false);
  });

  it('returns unavailable on submit network failure', async () => {
    const client = createClient();
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await client.submitAndPoll(
      {
        bank: 'cbe',
        referenceNumber: 'FT123456',
        settlementAccount: '1000',
      },
      'cbe-FT123456',
    );

    expect(result).toMatchObject({
      unavailable: true,
      verified: false,
      processingStatus: 'error',
    });
  });

  it('returns unavailable on poll network failure', async () => {
    const client = createClient();
    let call = 0;

    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            requestId: 'req-2',
            processingStatus: 'processing',
            verified: false,
          }),
          { status: 202 },
        );
      }
      throw new Error('poll failed');
    }) as typeof fetch;

    const result = await client.submitAndPoll(
      {
        bank: 'telebirr',
        transactionNumber: 'ABC999',
        settlementAccount: '0952723287',
      },
      'telebirr-ABC999',
    );

    expect(result).toMatchObject({
      unavailable: true,
      verified: false,
      processingStatus: 'error',
    });
  });

  it('persists requestId via onRequestId before polling', async () => {
    const client = createClient();
    const seen: string[] = [];
    let call = 0;

    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            requestId: 'req-persist',
            processingStatus: 'processing',
            verified: false,
          }),
          { status: 202 },
        );
      }
      return new Response(
        JSON.stringify({
          requestId: 'req-persist',
          processingStatus: 'completed',
          verified: true,
          data: {
            verified: true,
            status: 'success',
            amount: '10',
            currency: 'ETB',
            settlementAccountMatch: { matched: true },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await client.submitAndPoll(
      {
        bank: 'telebirr',
        transactionNumber: 'PERSIST1',
        settlementAccount: '0952723287',
      },
      'telebirr-PERSIST1',
      {
        onRequestId: async (requestId) => {
          seen.push(requestId);
        },
        maxPollAttempts: 1,
      },
    );

    expect(seen).toEqual(['req-persist']);
  });

  it('returns completed verified result without marking unavailable', async () => {
    const client = createClient();
    global.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          requestId: 'req-ok',
          processingStatus: 'completed',
          verified: true,
          data: {
            verified: true,
            status: 'success',
            amount: '25',
            currency: 'ETB',
            settlementAccountMatch: { matched: true },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await client.submitAndPoll(
      {
        bank: 'telebirr',
        transactionNumber: 'OKREF1',
        settlementAccount: '0952723287',
      },
      'telebirr-OKREF1',
    );

    expect(result.unavailable).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.processingStatus).toBe('completed');
    expect(result.record?.amount).toBe('25');
  });
});
