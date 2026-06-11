import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GameTimingConfigService } from './game-timing-config.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [GameTimingConfigService],
  exports: [GameTimingConfigService],
})
export class GameTimingConfigModule {}
