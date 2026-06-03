import { Module } from '@nestjs/common';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { BingoClaimsService } from './bingo-claims.service';

@Module({
  imports: [
    PrismaModule,
    GameRulesModule,
    GameEngineModule,
    RealtimeModule,
    WalletModule,
  ],
  providers: [BingoClaimsService],
  exports: [BingoClaimsService],
})
export class BingoClaimsModule {}
