import { Inject, Injectable, Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Message } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { FIREBASE_ADMIN_APP } from './firebase-admin.provider';
import type {
  AppPushNotificationPayload,
  PushCategory,
} from './types/push-category.type';

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

    this.logger.log(
      `Registered device userId=${userId} platform=${device.platform} tokenSuffix=${this.maskToken(device.fcmToken)} enabled=${device.enabled}`,
    );

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
    const result = await this.prisma.pushDevice.updateMany({
      where: {
        userId,
        fcmToken: token,
      },
      data: {
        enabled: false,
        lastSeenAt: now,
      },
    });

    this.logger.log(
      `Disabled device userId=${userId} matched=${result.count} tokenSuffix=${this.maskToken(token)}`,
    );

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
      this.logger.log(`Push skipped userId=${userId} reason=no_enabled_devices`);
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
        this.logger.log(
          `Push sent userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
        );
      } catch (error) {
        failedCount += 1;
        this.logger.warn(
          `Failed to send push notification userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}: ${
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
          this.logger.warn(
            `Disabled invalid push token userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
          );
        }
      }
    }

    this.logger.log(
      `Push summary userId=${userId} sent=${sentCount} failed=${failedCount}`,
    );

    return {
      userId,
      sentCount,
      failedCount,
    };
  }

  async sendToUsers(userIds: string[], payload: Omit<Message, 'token'>) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

    if (uniqueUserIds.length === 0) {
      this.logger.log('Push broadcast skipped reason=no_target_users');
      return {
        userCount: 0,
        sentCount: 0,
        failedCount: 0,
      };
    }

    const results = await Promise.all(
      uniqueUserIds.map((userId) => this.sendToUser(userId, payload)),
    );

    const summary = results.reduce(
      (summary, result) => {
        summary.userCount += 1;
        summary.sentCount += result.sentCount;
        summary.failedCount += result.failedCount;
        return summary;
      },
      {
        userCount: 0,
        sentCount: 0,
        failedCount: 0,
      },
    );

    this.logger.log(
      `Push broadcast summary users=${summary.userCount} sent=${summary.sentCount} failed=${summary.failedCount}`,
    );

    return summary;
  }

  async sendAppNotificationToUser(
    userId: string,
    payload: AppPushNotificationPayload,
  ) {
    return this.sendToUser(userId, this.buildAppNotificationMessage(payload));
  }

  async sendAppNotificationToUsers(
    userIds: string[],
    payload: AppPushNotificationPayload,
  ) {
    return this.sendToUsers(
      userIds,
      this.buildAppNotificationMessage(payload),
    );
  }

  async sendSystemNotificationToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    return this.sendAppNotificationToUser(userId, {
      category: 'SYSTEM',
      title,
      body,
      data,
    });
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

  private buildAppNotificationMessage(
    payload: AppPushNotificationPayload,
  ): Omit<Message, 'token'> {
    const data: Record<string, string> = {
      category: payload.category,
      title: payload.title,
      body: payload.body,
      ...(payload.route ? { route: payload.route } : {}),
      ...(payload.entityId ? { entityId: payload.entityId } : {}),
      ...(payload.data ?? {}),
    };

    this.logger.log(
      `Dispatching ${this.describeCategory(payload.category)} push route=${
        payload.route ?? 'none'
      } entityId=${payload.entityId ?? 'none'}`,
    );

    return {
      android: {
        priority: 'high',
      },
      data,
    };
  }

  private describeCategory(category: PushCategory) {
    return category.toLowerCase();
  }

  private maskToken(token: string) {
    return token.length <= 8 ? token : token.slice(-8);
  }
}
