import { Module } from '@nestjs/common';
import { GameQueueService } from '../games/game-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GameEngineService } from './game-engine.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [GameEngineService, GameQueueService],
  exports: [GameEngineService, GameQueueService],
})
export class GameEngineModule {}
