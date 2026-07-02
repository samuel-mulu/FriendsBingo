import { GeezSmsProvider } from './geezsms.provider';
import { SmsProviderAuthFailedException, SmsUnavailableException } from '../sms.errors';

describe('GeezSmsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends OTP via GET with token, phone, and message query params', async () => {
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
      expect.stringContaining('https://api.geezsms.com/api/v1/sms/send?'),
      { method: 'GET' },
    );

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('token=secret-token');
    expect(calledUrl).toContain('phone=251962520885');
    expect(calledUrl).toContain('msg=Your+Friends+Bin..+OTP+is+123456');
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
