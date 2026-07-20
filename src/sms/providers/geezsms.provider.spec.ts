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
});
