import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BingoClaimsModule } from '../bingo-claims/bingo-claims.module';
import { CalledNumbersModule } from '../called-numbers/called-numbers.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    WalletModule,
    GameEngineModule,
    CalledNumbersModule,
    BingoClaimsModule,
    RealtimeModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
