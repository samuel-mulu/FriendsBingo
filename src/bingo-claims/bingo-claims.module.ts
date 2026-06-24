import { Module } from '@nestjs/common';
import { GameTimingConfigModule } from '../game-timing-config/game-timing-config.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { PostGameRegistrationOpenerModule } from '../games/post-game-registration-opener.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { BingoClaimsService } from './bingo-claims.service';
import { WinnerWindowFinalizerService } from './winner-window-finalizer.service';

@Module({
  imports: [
    PrismaModule,
    GameTimingConfigModule,
    GameEngineModule,
    GameRulesModule,
    RealtimeModule,
    WalletModule,
    PostGameRegistrationOpenerModule,
  ],
  providers: [BingoClaimsService, WinnerWindowFinalizerService],
  exports: [BingoClaimsService, WinnerWindowFinalizerService],
})
export class BingoClaimsModule {}
