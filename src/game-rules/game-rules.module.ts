import { Module } from '@nestjs/common';
import { GameRulesService } from './game-rules.service';

@Module({
  providers: [GameRulesService],
  exports: [GameRulesService],
})
export class GameRulesModule {}
