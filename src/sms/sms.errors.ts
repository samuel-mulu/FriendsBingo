import { HttpException, HttpStatus } from '@nestjs/common';

export class SmsUnavailableException extends HttpException {
  constructor(
    message = 'SMS service is temporarily unavailable. Please try again.',
  ) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class SmsProviderAuthFailedException extends HttpException {
  constructor(message = 'SMS provider authentication failed') {
    super(message, HttpStatus.BAD_GATEWAY);
  }
}

export class SmsRateLimitedException extends HttpException {
  constructor(message = 'SMS rate limit exceeded. Please try again later.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
