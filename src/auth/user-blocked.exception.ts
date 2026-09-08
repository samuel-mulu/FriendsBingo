import { ForbiddenException } from '@nestjs/common';

export const USER_BLOCKED_CODE = 'USER_BLOCKED';

export function throwUserBlocked(reason?: string | null): never {
  throw new ForbiddenException({
    message: 'User account is blocked',
    code: USER_BLOCKED_CODE,
    details: {
      reason: reason?.trim() ? reason.trim() : null,
    },
  });
}
