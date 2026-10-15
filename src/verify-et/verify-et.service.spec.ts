import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { VerifyEtClient, VerifyEtClientResult } from './verify-et.client';
import { VerifyEtService } from './verify-et.service';

describe('VerifyEtService', () => {
  function createService(clientResultFactory: (
    body: Record<string, string>,
  ) => Promise<VerifyEtClientResult>) {
    const configService = {
      get: (key: string) => {
        const values: Record<string, string> = {
          TELEBIRR_SETTLEMENT_ACCOUNT: '0952723287',
          TELEBIRR_SETTLEMENT_ACCOUNT_2: '0961355799',
          CBE_SETTLEMENT_ACCOUNT: '1000123456789',
          CBE_ACCOUNT_SUFFIX: '12345678',
        };
        return values[key];
      },
    } as unknown as ConfigService;

    const verifyEtClient = {
      submitAndPoll: jest.fn(
        async (body: Record<string, string>) => clientResultFactory(body),
      ),
    } as unknown as VerifyEtClient;

    return {
      service: new VerifyEtService(configService, verifyEtClient),
      verifyEtClient,
    };
  }

  it('stops dual settlement when first candidate returns verified:false', async () => {
    const calls: string[] = [];
    const { service, verifyEtClient } = createService(async (body) => {
      calls.push(body.settlementAccount);
      return {
        verified: false,
        unavailable: false,
        processingStatus: 'completed',
        requestId: 'req-a',
        rawResponse: {},
        record: {
          verified: false,
          status: 'failed',
          settlementAccountMatch: { matched: false },
        },
      };
    });

    const result = await service.verifyDeposit({
      provider: PaymentProvider.TELEBIRR,
      reference: 'REFDUAL1',
      amount: '10',
      correlationId: 'corr-dual',
    });

    expect(calls).toEqual(['0952723287']);
    expect((verifyEtClient.submitAndPoll as jest.Mock).mock.calls).toHaveLength(
      1,
    );
    expect(result).toMatchObject({
      verified: false,
      errorCode: 'INVALID_TRANSACTION',
    });
  });

  it('tries second settlement account when verified and unmatched', async () => {
    const calls: string[] = [];
    const { service } = createService(async (body) => {
      calls.push(body.settlementAccount);
      if (body.settlementAccount === '0952723287') {
        return {
          verified: true,
          unavailable: false,
          processingStatus: 'completed',
          requestId: 'req-1',
          rawResponse: {},
          record: {
            verified: true,
            status: 'success',
            amount: '10',
            currency: 'ETB',
            settlementAccountMatch: { matched: false },
          },
        };
      }

      return {
        verified: true,
        unavailable: false,
        processingStatus: 'completed',
        requestId: 'req-2',
        rawResponse: {},
        record: {
          verified: true,
          status: 'success',
          amount: '10',
          currency: 'ETB',
          settlementAccountMatch: { matched: true },
        },
      };
    });

    const result = await service.verifyDeposit({
      provider: PaymentProvider.TELEBIRR,
      reference: 'REFDUAL2',
      amount: '10',
    });

    expect(calls).toEqual(['0952723287', '0961355799']);
    expect(result).toMatchObject({
      verified: true,
      settlementMatched: true,
      matchedSettlementAccount: '0961355799',
    });
  });

  it('maps pending poll exhaustion to VERIFICATION_PENDING', async () => {
    const { service } = createService(async () => ({
      verified: false,
      unavailable: true,
      processingStatus: 'pending',
      requestId: 'req-pending',
      rawResponse: {},
      pollCount: 10,
      pollElapsedMs: 15000,
    }));

    const result = await service.verifyDeposit({
      provider: PaymentProvider.CBE,
      reference: 'FTPENDING1',
      amount: '50',
    });

    expect(result).toMatchObject({
      verified: false,
      errorCode: 'VERIFICATION_PENDING',
      processingStatus: 'pending',
    });
  });

  it('maps network unavailable to VERIFICATION_UNAVAILABLE', async () => {
    const { service } = createService(async () => ({
      verified: false,
      unavailable: true,
      processingStatus: 'error',
      rawResponse: { error: 'submit_failed' },
    }));

    const result = await service.verifyDeposit({
      provider: PaymentProvider.CBE,
      reference: 'FTERR1',
      amount: '50',
    });

    expect(result.errorCode).toBe('VERIFICATION_UNAVAILABLE');
  });

  it('returns SETTLEMENT_MISMATCH for permanent unmatched settlement', async () => {
    const { service } = createService(async () => ({
      verified: true,
      unavailable: false,
      processingStatus: 'completed',
      requestId: 'req-mismatch',
      rawResponse: {},
      record: {
        verified: true,
        status: 'success',
        amount: '50',
        currency: 'ETB',
        settlementAccountMatch: { matched: false },
      },
    }));

    // Use CBE (single settlement) so unmatched is final.
    const result = await service.verifyDeposit({
      provider: PaymentProvider.CBE,
      reference: 'FTMISMATCH1',
      amount: '50',
    });

    expect(result).toMatchObject({
      verified: true,
      settlementMatched: false,
      errorCode: 'SETTLEMENT_MISMATCH',
    });
  });
});
