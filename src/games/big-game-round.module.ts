import { Module } from '@nestjs/common';
import { GameTimingConfigModule } from '../game-timing-config/game-timing-config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BigGameTicketModule } from './big-game-ticket.module';
import { BigGameRoundService } from './big-game-round.service';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';

@Module({
  imports: [PrismaModule, RealtimeModule, BigGameTicketModule, GameTimingConfigModule],
  providers: [BigGameRoundService, GameLifecycleDebugLogger],
  exports: [BigGameRoundService],
})
export class BigGameRoundModule {}
