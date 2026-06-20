import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [firebaseAdminProvider, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
