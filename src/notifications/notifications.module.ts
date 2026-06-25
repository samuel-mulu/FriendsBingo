import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { BigGamePushReminderService } from './big-game-push-reminder.service';
import { GamePushNotificationsService } from './game-push-notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    firebaseAdminProvider,
    NotificationsService,
    GamePushNotificationsService,
    BigGamePushReminderService,
  ],
  exports: [
    NotificationsService,
    GamePushNotificationsService,
    BigGamePushReminderService,
  ],
})
export class NotificationsModule {}
