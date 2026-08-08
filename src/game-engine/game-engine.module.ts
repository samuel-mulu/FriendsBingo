import { Module, forwardRef } from '@nestjs/common';
import { GameQueueService } from '../games/game-queue.service';
import { OperationsCacheModule } from '../games/operations-cache.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { PostGameRegistrationOpenerModule } from '../games/post-game-registration-opener.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppDisplayConfigModule } from '../app-display-config/app-display-config.module';
import { GameEngineService } from './game-engine.service';
import { GameLifecycleDebugLogger } from '../games/game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from '../games/game-operation-invariants.service';

@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    OperationsCacheModule,
    LeaderboardModule,
    AppDisplayConfigModule,
    forwardRef(() => PostGameRegistrationOpenerModule),
    GameRulesModule,
    NotificationsModule,
  ],
  providers: [
    GameEngineService,
    GameQueueService,
    GameLifecycleDebugLogger,
    GameOperationInvariantsService,
  ],
  exports: [GameEngineService, GameQueueService],
})
export class GameEngineModule {}