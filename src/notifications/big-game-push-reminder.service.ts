import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';

const TICK_MS = 60_000;

@Injectable()
export class BigGamePushReminderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BigGamePushReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly gamePushNotificationsService: GamePushNotificationsService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.ticking) {
      return;
    }

    this.ticking = true;
    try {
      await this.gamePushNotificationsService.runBigGameReminderTick();
    } catch (error) {
      this.logger.warn(
        `Big game reminder tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.ticking = false;
    }
  }
}
