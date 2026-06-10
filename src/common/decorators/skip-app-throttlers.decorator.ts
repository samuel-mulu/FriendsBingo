import { SkipThrottle } from '@nestjs/throttler';

/** Skips both registered throttlers (`default` + `auth`). */
export const SkipAppThrottlers = () =>
  SkipThrottle({ default: true, auth: true });
