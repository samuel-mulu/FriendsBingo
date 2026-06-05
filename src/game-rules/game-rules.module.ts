import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GameRulesService } from './game-rules.service';

@Module({
  imports: [PrismaModule],
  providers: [GameRulesService],
  exports: [GameRulesService],
})
export class GameRulesModule {}
