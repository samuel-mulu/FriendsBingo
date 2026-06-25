import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

const TICK_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshTokenCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  onModuleInit() {
    void this.cleanup();
    this.timer = setInterval(() => {
      void this.cleanup();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async cleanup() {
    try {
      const removed = await this.refreshTokenService.cleanupExpiredTokens();
      if (removed > 0) {
        this.logger.log(`Removed ${removed} expired refresh tokens`);
      }
    } catch (error) {
      this.logger.warn(
        `Refresh token cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
