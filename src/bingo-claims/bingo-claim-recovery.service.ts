import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BingoClaimsService } from './bingo-claims.service';

@Injectable()
export class BingoClaimRecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BingoClaimRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly config: ConfigService,
    private readonly claims: BingoClaimsService,
  ) {}

  onApplicationBootstrap() {
    // Requires ALL validators to have Stage 2A fencing before enabling.
    if (this.config.get<boolean>('BINGO_CLAIM_RECOVERY_ENABLED') !== true)
      return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  private tick(): Promise<void> {
    if (this.shuttingDown || this.inFlight) return Promise.resolve();
    this.inFlight = this.scan().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async scan() {
    try {
      await this.claims.recoverOrphanedCheckingClaims(() => this.shuttingDown);
    } catch (error) {
      this.logger.error(
        'CHECKING recovery scan failed; will retry on the next tick',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
