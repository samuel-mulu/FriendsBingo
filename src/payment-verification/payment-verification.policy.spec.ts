import { isMockPaymentVerificationAllowed } from './payment-verification.policy';

describe('isMockPaymentVerificationAllowed', () => {
  it('blocks mock verification in production by default', () => {
    const configService = {
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

    expect(isMockPaymentVerificationAllowed(configService as never)).toBe(
      false,
    );
  });

  it('allows mock verification in non-production', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') {
          return 'test';
        }

        return undefined;
      }),
    };

    expect(isMockPaymentVerificationAllowed(configService as never)).toBe(true);
  });
});
