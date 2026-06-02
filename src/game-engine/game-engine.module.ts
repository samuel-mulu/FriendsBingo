import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GameEngineService } from './game-engine.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [GameEngineService],
  exports: [GameEngineService],
})
export class GameEngineModule {}
