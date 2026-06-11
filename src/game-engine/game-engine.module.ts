import { Module } from '@nestjs/common';
import { GameQueueService } from '../games/game-queue.service';
import { OperationsCacheModule } from '../games/operations-cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GameEngineService } from './game-engine.service';

@Module({
  imports: [PrismaModule, RealtimeModule, OperationsCacheModule],
  providers: [GameEngineService, GameQueueService],
  exports: [GameEngineService, GameQueueService],
})
export class GameEngineModule {}
