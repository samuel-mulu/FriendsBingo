import { Module } from '@nestjs/common';
import { AdminBroadcastsService } from '../admin/admin-broadcasts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { BigGamePushReminderService } from './big-game-push-reminder.service';
import { GamePushNotificationsService } from './game-push-notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDeliveryGuardService } from './push-delivery-guard.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [
    firebaseAdminProvider,
    AdminBroadcastsService,
    PushDeliveryGuardService,
    NotificationsService,
    GamePushNotificationsService,
    BigGamePushReminderService,
  ],
  exports: [
    NotificationsService,
    PushDeliveryGuardService,
    GamePushNotificationsService,
    BigGamePushReminderService,
  ],
})
export class NotificationsModule {}
