import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GameRuleEvaluationService } from './game-rule-evaluation.service';
import { GameRulesService } from './game-rules.service';

@Module({
  imports: [PrismaModule],
  providers: [GameRulesService, GameRuleEvaluationService],
  exports: [GameRulesService, GameRuleEvaluationService],
})
export class GameRulesModule {}
