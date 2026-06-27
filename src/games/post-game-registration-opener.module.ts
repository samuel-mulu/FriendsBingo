import { Module } from '@nestjs/common';
import { GameTimingConfigModule } from '../game-timing-config/game-timing-config.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { OperationsCacheModule } from './operations-cache.module';
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';

@Module({
  imports: [
    PrismaModule,
    GameTimingConfigModule,
    OperationsCacheModule,
    RealtimeModule,
    NotificationsModule,
  ],
  providers: [
    PostGameRegistrationOpenerService,
    AutoReadyCountdownRepairService,
    GameLifecycleDebugLogger,
    GameOperationInvariantsService,
  ],
  exports: [PostGameRegistrationOpenerService, AutoReadyCountdownRepairService],
})
export class PostGameRegistrationOpenerModule {}
