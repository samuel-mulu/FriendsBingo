import { GeezSmsProvider } from './geezsms.provider';

describe('GeezSmsProvider.evaluateGeezResponse', () => {
  const provider = new GeezSmsProvider({
    get: () => undefined,
  } as never);

  it('accepts classic message_status=success', () => {
    expect(
      provider.evaluateGeezResponse({ message_status: 'success' }, 200),
    ).toMatchObject({ accepted: true, reason: 'status' });
  });

  it('accepts broader statuses like sent/queued', () => {
    for (const status of ['sent', 'queued', 'accepted', 'delivered', 'OK']) {
      expect(
        provider.evaluateGeezResponse({ message_status: status }, 200).accepted,
      ).toBe(true);
    }
  });

  it('rejects failed statuses', () => {
    expect(
      provider.evaluateGeezResponse({ message_status: 'failed' }, 200).accepted,
    ).toBe(false);
  });

  it('rejects explicit error payloads', () => {
    expect(
      provider.evaluateGeezResponse(
        { message_status: 'success', error: true },
        200,
      ).accepted,
    ).toBe(false);
  });

  it('accepts HTTP 2xx with unknown status and no error', () => {
    expect(
      provider.evaluateGeezResponse({ message_status: 'weird_ok' }, 200),
    ).toMatchObject({ accepted: true, reason: 'http_ok_no_error' });
  });

  it('accepts empty HTTP 2xx body', () => {
    expect(provider.evaluateGeezResponse(null, 200).accepted).toBe(true);
  });

  it('accepts Geez OTP success payload', () => {
    expect(
      provider.evaluateGeezResponse(
        {
          error: false,
          code: 6678,
          msg: 'SMS has been sent successfully.',
          data: {
            msg: 'SMS_SENT_SUCCSSFULLY',
            code: 6678,
            api_log_id: 4798019,
          },
        },
        200,
      ),
    ).toMatchObject({ accepted: true, reason: 'otp_success' });
  });
});

describe('GeezSmsProvider.extractOtpCode', () => {
  const provider = new GeezSmsProvider({
    get: () => undefined,
  } as never);

  it('extracts 4-digit code from top-level and data.code', () => {
    expect(
      provider.extractOtpCode({
        error: false,
        code: 6678,
        msg: 'SMS has been sent successfully.',
        data: { msg: 'SMS_SENT_SUCCSSFULLY', code: 6678 },
      }),
    ).toBe('6678');
  });

  it('pads short numeric codes to 4 digits', () => {
    expect(provider.extractOtpCode({ code: 42 })).toBe('0042');
  });

  it('returns null when code is not 4 digits', () => {
    expect(provider.extractOtpCode({ code: 123456 })).toBeNull();
    expect(provider.extractOtpCode({ code: 'abc' })).toBeNull();
    expect(provider.extractOtpCode(null)).toBeNull();
  });

  it('prefers explicit otp/pin fields', () => {
    expect(provider.extractOtpCode({ otp: '9911', code: 6678 })).toBe('9911');
    expect(provider.extractOtpCode({ pin: '2244' })).toBe('2244');
  });
});
