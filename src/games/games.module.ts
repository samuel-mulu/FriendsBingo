import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BingoClaimsModule } from '../bingo-claims/bingo-claims.module';
import { CalledNumbersModule } from '../called-numbers/called-numbers.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { AutoCallService } from './auto-call.service';
import { CartelaReservationExpirerService } from './cartela-reservation-expirer.service';
import { GameAutoStartSchedulerService } from './game-auto-start-scheduler.service';
import { GameDataRetentionService } from './game-data-retention.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { GamesController } from './games.controller';
import { GameQueueService } from './game-queue.service';
import { GamesService } from './games.service';
import { GameTimingConfigModule } from '../game-timing-config/game-timing-config.module';
import { OperationsCacheModule } from './operations-cache.module';
import { PostGameRegistrationOpenerModule } from './post-game-registration-opener.module';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { GameOperationRepairService } from './game-operation-repair.service';

@Module({
  imports: [
    GameTimingConfigModule,
    OperationsCacheModule,
    PostGameRegistrationOpenerModule,
    NotificationsModule,
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
  providers: [
    GamesService,
    GameQueueService,
    GameLifecycleService,
    AutoCallService,
    CartelaReservationExpirerService,
    GameAutoStartSchedulerService,
    GameDataRetentionService,
    GameLifecycleDebugLogger,
    GameOperationInvariantsService,
    GameOperationRepairService,
  ],
  exports: [
    GamesService,
    GameQueueService,
    GameLifecycleService,
    AutoCallService,
    CartelaReservationExpirerService,
    GameAutoStartSchedulerService,
    PostGameRegistrationOpenerModule,
  ],
})
export class GamesModule {}
