import { GeezSmsProvider } from './geezsms.provider';
import { SmsProviderAuthFailedException, SmsUnavailableException } from '../sms.errors';

describe('GeezSmsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends OTP with token, phone, and message', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new GeezSmsProvider({
      get: jest.fn((key: string) => {
        if (key === 'GEEZSMS_TOKEN') return 'secret-token';
        if (key === 'GEEZSMS_BASE_URL') return 'https://api.geezsms.com/api/v1';
        return undefined;
      }),
    } as never);

    await provider.sendOtp('251962520885', '123456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.geezsms.com/api/v1/sms/send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(body).toContain('token=secret-token');
    expect(body).toContain('phone=251962520885');
    expect(body).toContain('msg=Your+Friends+Bingo+OTP+is+123456');
  });

  it('throws when provider auth fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as typeof fetch;

    const provider = new GeezSmsProvider({
      get: jest.fn(() => 'secret-token'),
    } as never);

    await expect(provider.sendOtp('251962520885', '123456')).rejects.toBeInstanceOf(
      SmsProviderAuthFailedException,
    );
  });

  it('throws when network fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as typeof fetch;

    const provider = new GeezSmsProvider({
      get: jest.fn(() => 'secret-token'),
    } as never);

    await expect(provider.sendOtp('251962520885', '123456')).rejects.toBeInstanceOf(
      SmsUnavailableException,
    );
  });
});
