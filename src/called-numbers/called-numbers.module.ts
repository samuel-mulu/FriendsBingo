import { Module, forwardRef } from '@nestjs/common';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CalledNumbersService } from './called-numbers.service';

@Module({
  imports: [PrismaModule, RealtimeModule, forwardRef(() => GameEngineModule)],
  providers: [CalledNumbersService],
  exports: [CalledNumbersService],
})
export class CalledNumbersModule {}
