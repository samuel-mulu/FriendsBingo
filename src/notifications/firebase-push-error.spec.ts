import {
  formatFailureCodes,
  getFirebaseErrorCode,
  isInvalidTokenError,
} from './firebase-push-error';

function firebaseError(code: string, message = 'Requested entity was not found.') {
  const error = new Error(message) as Error & {
    code: string;
    errorInfo: { code: string; message: string };
  };
  error.code = code;
  error.errorInfo = { code, message };
  return error;
}

describe('firebase-push-error', () => {
  it('reads messaging/registration-token-not-registered from error.code', () => {
    const error = firebaseError(
      'messaging/registration-token-not-registered',
    );

    expect(getFirebaseErrorCode(error)).toBe(
      'messaging/registration-token-not-registered',
    );
    expect(isInvalidTokenError(error)).toBe(true);
  });

  it('reads messaging/invalid-registration-token from error.code', () => {
    const error = firebaseError('messaging/invalid-registration-token');

    expect(getFirebaseErrorCode(error)).toBe(
      'messaging/invalid-registration-token',
    );
    expect(isInvalidTokenError(error)).toBe(true);
  });

  it('reads the same codes from errorInfo.code when code is missing', () => {
    const unregistered = {
      message: 'Requested entity was not found.',
      errorInfo: {
        code: 'messaging/registration-token-not-registered',
      },
    };
    const invalid = {
      message: 'The registration token is not a valid FCM registration token',
      errorInfo: {
        code: 'messaging/invalid-registration-token',
      },
    };

    expect(isInvalidTokenError(unregistered)).toBe(true);
    expect(isInvalidTokenError(invalid)).toBe(true);
    expect(getFirebaseErrorCode(unregistered)).toBe(
      'messaging/registration-token-not-registered',
    );
  });

  it('does not classify transient Firebase or network errors as invalid tokens', () => {
    expect(
      isInvalidTokenError(firebaseError('messaging/internal-error', 'Internal')),
    ).toBe(false);
    expect(
      isInvalidTokenError(
        firebaseError('messaging/server-unavailable', 'Unavailable'),
      ),
    ).toBe(false);
    expect(
      isInvalidTokenError(
        firebaseError('messaging/quota-exceeded', 'Quota exceeded'),
      ),
    ).toBe(false);
    expect(isInvalidTokenError(firebaseError('ETIMEDOUT', 'timed out'))).toBe(
      false,
    );
    expect(isInvalidTokenError(firebaseError('ECONNRESET', 'reset'))).toBe(
      false,
    );
  });

  it('does not classify an unknown Error as an invalid token', () => {
    expect(isInvalidTokenError(new Error('send failed'))).toBe(false);
    expect(getFirebaseErrorCode(new Error('send failed'))).toBe('unknown');
  });

  it('falls back to message only when no Firebase code is present', () => {
    expect(
      isInvalidTokenError(new Error('registration-token-not-registered')),
    ).toBe(true);
    expect(
      isInvalidTokenError(new Error('invalid-registration-token')),
    ).toBe(true);
  });

  it('does not let a transient code be overridden by a message substring', () => {
    expect(
      isInvalidTokenError(
        firebaseError(
          'messaging/internal-error',
          'invalid-registration-token',
        ),
      ),
    ).toBe(false);
  });

  it('formats aggregated failure codes for diagnostics', () => {
    expect(formatFailureCodes({})).toBe('{}');
    expect(
      formatFailureCodes({
        'messaging/internal-error': 2,
        'messaging/registration-token-not-registered': 469,
      }),
    ).toBe(
      '{messaging/internal-error:2,messaging/registration-token-not-registered:469}',
    );
  });
});
