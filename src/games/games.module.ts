import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BingoClaimsModule } from '../bingo-claims/bingo-claims.module';
import { CalledNumbersModule } from '../called-numbers/called-numbers.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { GamesController } from './games.controller';
import { GameQueueService } from './game-queue.service';
import { GamesService } from './games.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    WalletModule,
    GameRulesModule,
    GameEngineModule,
    CalledNumbersModule,
    BingoClaimsModule,
    RealtimeModule,
  ],
  controllers: [GamesController],
  providers: [GamesService, GameQueueService],
  exports: [GamesService, GameQueueService],
})
export class GamesModule {}
