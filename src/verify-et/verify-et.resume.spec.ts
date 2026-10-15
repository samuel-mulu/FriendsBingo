import { ConfigService } from '@nestjs/config';
import { VerifyEtClient } from './verify-et.client';

describe('VerifyEtClient pollExistingRequest', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('polls GET only and does not POST', async () => {
    const configService = {
      get: (key: string) =>
        ({
          VERIFY_ET_BASE_URL: 'https://verify.et',
          VERIFY_ET_WAIT_MS: '0',
          VERIFY_ET_POLL_ATTEMPTS: '2',
          VERIFY_ET_POLL_INTERVAL_MS: '1',
          VERIFY_ET_API_KEY: 'test-key',
        })[key],
    } as unknown as ConfigService;
    const client = new VerifyEtClient(configService);
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/verify/req-resume-1');
      expect(url).not.toContain('waitMs');
      return new Response(
        JSON.stringify({
          requestId: 'req-resume-1',
          processingStatus: 'completed',
          verified: true,
          data: {
            verified: true,
            status: 'success',
            amount: '20',
            currency: 'ETB',
            settlementAccountMatch: { matched: true },
          },
        }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await client.pollExistingRequest('req-resume-1', {
      correlationId: 'corr-resume',
      maxPollAttempts: 1,
    });

    expect(result.unavailable).toBe(false);
    expect(result.verified).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.method ?? 'GET').toBe('GET');
  });
});
