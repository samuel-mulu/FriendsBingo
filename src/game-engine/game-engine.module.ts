import { Module } from '@nestjs/common';
import { GameQueueService } from '../games/game-queue.service';
import { OperationsCacheModule } from '../games/operations-cache.module';
import { PostGameRegistrationOpenerModule } from '../games/post-game-registration-opener.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GameEngineService } from './game-engine.service';

@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    OperationsCacheModule,
    PostGameRegistrationOpenerModule,
    GameRulesModule,
    NotificationsModule,
  ],
  providers: [GameEngineService, GameQueueService],
  exports: [GameEngineService, GameQueueService],
})
export class GameEngineModule {}
