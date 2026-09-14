import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChainRoundService } from './chain-round.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [ChainRoundService],
  exports: [ChainRoundService],
})
export class ChainRoundModule {}
