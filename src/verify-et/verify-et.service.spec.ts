import { PaymentProvider } from '@prisma/client';
import { VerifyEtClient } from './verify-et.client';
import { VerifyEtService } from './verify-et.service';

describe('VerifyEtService', () => {
  function createService() {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          TELEBIRR_SETTLEMENT_ACCOUNT: '0962520885',
          CBE_SETTLEMENT_ACCOUNT: '1002003004005006',
          AWASH_SETTLEMENT_ACCOUNT: '01320811472100',
          BOA_SETTLEMENT_ACCOUNT: '12345678901',
          CBE_ACCOUNT_SUFFIX: '40005006',
          BOA_ACCOUNT_SUFFIX: '67890',
        };
        return values[key];
      }),
    };

    const verifyEtClient = {
      submitAndPoll: jest.fn(),
    };

    const service = new VerifyEtService(
      configService as never,
      verifyEtClient as never,
    );

    return { service, verifyEtClient };
  }

  it('maps successful Telebirr verification', async () => {
    const { service, verifyEtClient } = createService();
    verifyEtClient.submitAndPoll.mockResolvedValue({
      verified: true,
      unavailable: false,
      requestId: 'req-1',
      record: {
        verified: true,
        amount: '100',
        receiverName: 'Friends Bingo',
        settlementAccountMatch: { matched: true },
      },
      rawResponse: { finalResponse: { ok: true } },
    });

    const result = await service.verifyDeposit({
      provider: PaymentProvider.TELEBIRR,
      reference: 'DFF3WLQB6R',
      amount: '100',
    });

    expect(result.verified).toBe(true);
    expect(result.settlementMatched).toBe(true);
    expect(result.amount).toBe('100');
    expect(verifyEtClient.submitAndPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        bank: 'telebirr',
        transactionNumber: 'DFF3WLQB6R',
      }),
      expect.any(String),
    );
  });

  it('returns VERIFICATION_UNAVAILABLE when Verify.ET times out', async () => {
    const { service, verifyEtClient } = createService();
    verifyEtClient.submitAndPoll.mockResolvedValue({
      verified: false,
      unavailable: true,
      rawResponse: { error: 'timeout' },
    });

    const result = await service.verifyDeposit({
      provider: PaymentProvider.CBE,
      reference: 'FT26152ZN0XY',
      amount: '100',
    });

    expect(result.errorCode).toBe('VERIFICATION_UNAVAILABLE');
    expect(result.verified).toBe(false);
  });

  it('submits CBE verification with required 8-digit account suffix', async () => {
    const { service, verifyEtClient } = createService();
    verifyEtClient.submitAndPoll.mockResolvedValue({
      verified: true,
      unavailable: false,
      requestId: 'req-cbe',
      record: {
        verified: true,
        amount: '100',
        settlementAccountMatch: { matched: true },
      },
      rawResponse: {},
    });

    await service.verifyDeposit({
      provider: PaymentProvider.CBE,
      reference: 'FT26152ZN0XY',
      amount: '100',
    });

    expect(verifyEtClient.submitAndPoll).toHaveBeenCalledWith(
      {
        bank: 'cbe',
        referenceNumber: 'FT26152ZN0XY',
        settlementAccount: '1002003004005006',
        accountSuffix: '40005006',
        suffix: '40005006',
      },
      'cbe-FT26152ZN0XY',
    );
  });
});
