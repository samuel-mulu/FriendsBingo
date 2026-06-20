import { Inject, Injectable, Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Message } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { FIREBASE_ADMIN_APP } from './firebase-admin.provider';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FIREBASE_ADMIN_APP) private readonly firebaseApp: App,
  ) {}

  async registerDevice(userId: string, registerDeviceDto: RegisterDeviceDto) {
    const now = new Date();
    const device = await this.prisma.pushDevice.upsert({
      where: { fcmToken: registerDeviceDto.token },
      create: {
        userId,
        fcmToken: registerDeviceDto.token,
        platform: registerDeviceDto.platform,
        enabled: true,
        lastSeenAt: now,
      },
      update: {
        userId,
        platform: registerDeviceDto.platform,
        enabled: true,
        lastSeenAt: now,
      },
    });

    return {
      id: device.id,
      token: device.fcmToken,
      platform: device.platform,
      enabled: device.enabled,
      lastSeenAt: device.lastSeenAt,
    };
  }

  async unregisterDevice(userId: string, token: string) {
    const now = new Date();
    await this.prisma.pushDevice.updateMany({
      where: {
        userId,
        fcmToken: token,
      },
      data: {
        enabled: false,
        lastSeenAt: now,
      },
    });

    return {
      token,
      disabled: true,
      lastSeenAt: now,
    };
  }

  async sendToUser(userId: string, payload: Omit<Message, 'token'>) {
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId,
        enabled: true,
      },
      select: {
        id: true,
        fcmToken: true,
      },
    });

    if (devices.length === 0) {
      return {
        userId,
        sentCount: 0,
        failedCount: 0,
      };
    }

    const messaging = getMessaging(this.firebaseApp);
    let sentCount = 0;
    let failedCount = 0;

    for (const device of devices) {
      try {
        await messaging.send({
          ...payload,
          token: device.fcmToken,
        });
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        this.logger.warn(
          `Failed to send push notification to device ${device.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );

        if (this.isInvalidTokenError(error)) {
          await this.prisma.pushDevice.update({
            where: { id: device.id },
            data: {
              enabled: false,
              lastSeenAt: new Date(),
            },
          });
        }
      }
    }

    return {
      userId,
      sentCount,
      failedCount,
    };
  }

  private isInvalidTokenError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes('registration-token-not-registered') ||
      error.message.includes('invalid-registration-token')
    );
  }
}
