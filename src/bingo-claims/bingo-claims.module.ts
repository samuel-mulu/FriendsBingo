import { Module } from '@nestjs/common';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { BingoClaimsService } from './bingo-claims.service';
import { WinnerWindowFinalizerService } from './winner-window-finalizer.service';

@Module({
  imports: [PrismaModule, GameEngineModule, GameRulesModule, RealtimeModule, WalletModule],
  providers: [BingoClaimsService, WinnerWindowFinalizerService],
  exports: [BingoClaimsService, WinnerWindowFinalizerService],
})
export class BingoClaimsModule {}
