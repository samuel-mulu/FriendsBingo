import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Message } from 'firebase-admin/messaging';
import { ObservabilityService } from '../observability/observability.service';
import { RequestContextService } from '../observability/request-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { FIREBASE_ADMIN_APP } from './firebase-admin.provider';
import {
  formatFailureCodes,
  getFirebaseErrorCode,
  incrementFailureCode,
  isInvalidTokenError,
  mergeFailureCodes,
} from './firebase-push-error';
import { PushDeliveryGuardService } from './push-delivery-guard.service';
import { NotificationConfigService } from '../notification-config/notification-config.service';
import { mapWithConcurrency } from './utils/map-with-concurrency';
import { normalizePushEntityId } from './push-rate-policy';
import type { AppPushBroadcastSummary } from './types/app-push-broadcast-summary.type';
import type {
  AppPushNotificationPayload,
  PushCategory,
} from './types/push-category.type';

type BroadcastPushDevice = {
  id: string;
  userId: string;
  fcmToken: string;
};

type BroadcastUserSendResult = {
  userId: string;
  deviceCount: number;
  sentCount: number;
  failedCount: number;
  invalidTokensDisabled: number;
  failureCodes: Record<string, number>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationConfigService: NotificationConfigService,
    private readonly pushDeliveryGuard: PushDeliveryGuardService,
    private readonly observability: ObservabilityService,
    private readonly requestContext: RequestContextService,
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
      `${this.logPrefix()} Registered device userId=${userId} platform=${device.platform} tokenSuffix=${this.maskToken(device.fcmToken)} enabled=${device.enabled}`,
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
      `${this.logPrefix()} Disabled device userId=${userId} matched=${result.count} tokenSuffix=${this.maskToken(token)}`,
    );

    return {
      token,
      disabled: true,
      lastSeenAt: now,
    };
  }

  async sendToUser(userId: string, payload: Omit<Message, 'token'>) {
    if (!(await this.isPushNotificationsEnabled())) {
      this.logger.log(
        `${this.logPrefix()} Push skipped userId=${userId} reason=push_notifications_disabled`,
      );
      return {
        userId,
        sentCount: 0,
        failedCount: 0,
      };
    }

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
      this.logger.log(
        `${this.logPrefix()} Push skipped userId=${userId} reason=no_enabled_devices`,
      );
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
        this.observability.recordPushDelivery('success');
        this.logger.log(
          `${this.logPrefix()} Push sent userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
        );
      } catch (error) {
        failedCount += 1;
        this.observability.recordPushDelivery('failure');
        this.logger.warn(
          `${this.logPrefix()} push_send_failed code=${getFirebaseErrorCode(error)} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
        );

        if (isInvalidTokenError(error)) {
          await this.prisma.pushDevice.update({
            where: { id: device.id },
            data: {
              enabled: false,
              lastSeenAt: new Date(),
            },
          });
          this.logger.warn(
            `${this.logPrefix()} Disabled invalid push token userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
          );
        }
      }
    }

    this.logger.log(
      `${this.logPrefix()} Push summary userId=${userId} sent=${sentCount} failed=${failedCount}`,
    );

    return {
      userId,
      sentCount,
      failedCount,
    };
  }

  async sendToUsers(userIds: string[], payload: Omit<Message, 'token'>) {
    const stopTimer = this.observability.startPushBatch('send_to_users');
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

    if (uniqueUserIds.length === 0) {
      try {
        this.logger.log(
          `${this.logPrefix()} Push broadcast skipped reason=no_target_users`,
        );
        return {
          userCount: 0,
          sentCount: 0,
          failedCount: 0,
        };
      } finally {
        stopTimer();
      }
    }

    try {
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
        `${this.logPrefix()} Push broadcast summary users=${summary.userCount} sent=${summary.sentCount} failed=${summary.failedCount}`,
      );

      return summary;
    } finally {
      stopTimer();
    }
  }

  async sendAppNotificationToUser(
    userId: string,
    payload: AppPushNotificationPayload,
  ) {
    const eligibleUserIds = await this.pushDeliveryGuard.filterUsersForPush(
      [userId],
      payload,
    );
    if (eligibleUserIds.length === 0) {
      return {
        userId,
        sentCount: 0,
        failedCount: 0,
      };
    }

    const result = await this.sendToUser(
      userId,
      this.buildAppNotificationMessage(payload),
    );
    if (result.sentCount > 0) {
      await this.pushDeliveryGuard.recordSuccessfulPush(userId, payload);
    }

    return result;
  }

  async sendAppNotificationToUsers(
    userIds: string[],
    payload: AppPushNotificationPayload,
  ) {
    const stopTimer = this.observability.startPushBatch(
      'send_app_notification_to_users',
    );
    const requestedUserIds = [...new Set(userIds.filter(Boolean))];
    const totalStartedAt = Date.now();
    try {
      if (requestedUserIds.length === 0) {
        return this.logBroadcastSummary(
          this.buildBroadcastSummary({
            payload,
            requestedUsers: 0,
            eligibleUsers: 0,
            reservedUsers: 0,
            duplicateUsersSkipped: 0,
            rateLimitedOrFilteredUsers: 0,
            usersWithDevices: 0,
            usersWithoutDevices: 0,
            deviceCount: 0,
            deviceSendsSucceeded: 0,
            deviceSendsFailed: 0,
            invalidTokensDisabled: 0,
            reservationDurationMs: 0,
            deviceLookupDurationMs: 0,
            firebaseDurationMs: 0,
            totalDurationMs: Date.now() - totalStartedAt,
            configuredConcurrency: this.getBroadcastConcurrency(),
          }),
        );
      }

      if (!(await this.isPushNotificationsEnabled())) {
        return this.logBroadcastSummary(
          this.buildBroadcastSummary({
            payload,
            requestedUsers: requestedUserIds.length,
            eligibleUsers: 0,
            reservedUsers: 0,
            duplicateUsersSkipped: 0,
            rateLimitedOrFilteredUsers: requestedUserIds.length,
            usersWithDevices: 0,
            usersWithoutDevices: 0,
            deviceCount: 0,
            deviceSendsSucceeded: 0,
            deviceSendsFailed: 0,
            invalidTokensDisabled: 0,
            reservationDurationMs: 0,
            deviceLookupDurationMs: 0,
            firebaseDurationMs: 0,
            totalDurationMs: Date.now() - totalStartedAt,
            configuredConcurrency: this.getBroadcastConcurrency(),
          }),
          'push_notifications_disabled',
        );
      }

      const eligibleUserIds = await this.pushDeliveryGuard.filterUsersForPush(
        requestedUserIds,
        payload,
      );
      const rateLimitedOrFilteredUsers =
        requestedUserIds.length - eligibleUserIds.length;

      if (eligibleUserIds.length === 0) {
        return this.logBroadcastSummary(
          this.buildBroadcastSummary({
            payload,
            requestedUsers: requestedUserIds.length,
            eligibleUsers: 0,
            reservedUsers: 0,
            duplicateUsersSkipped: 0,
            rateLimitedOrFilteredUsers,
            usersWithDevices: 0,
            usersWithoutDevices: 0,
            deviceCount: 0,
            deviceSendsSucceeded: 0,
            deviceSendsFailed: 0,
            invalidTokensDisabled: 0,
            reservationDurationMs: 0,
            deviceLookupDurationMs: 0,
            firebaseDurationMs: 0,
            totalDurationMs: Date.now() - totalStartedAt,
            configuredConcurrency: this.getBroadcastConcurrency(),
          }),
          'no_eligible_users',
        );
      }

      const reservationStartedAt = Date.now();
      // Broadcast dedupe is now reserve-before-send: the row marks a reserved
      // attempt, not guaranteed Firebase delivery, so concurrent duplicates
      // cannot double-send the same user/category/entityId notification.
      const reservation = await this.pushDeliveryGuard.reserveDeliveries(
        eligibleUserIds,
        payload,
      );
      const reservationDurationMs = Date.now() - reservationStartedAt;
      const reservedUserIds = reservation.reservedUserIds;

      if (reservedUserIds.length === 0) {
        return this.logBroadcastSummary(
          this.buildBroadcastSummary({
            payload,
            requestedUsers: requestedUserIds.length,
            eligibleUsers: eligibleUserIds.length,
            reservedUsers: 0,
            duplicateUsersSkipped: reservation.skippedDuplicates,
            rateLimitedOrFilteredUsers,
            usersWithDevices: 0,
            usersWithoutDevices: 0,
            deviceCount: 0,
            deviceSendsSucceeded: 0,
            deviceSendsFailed: 0,
            invalidTokensDisabled: 0,
            reservationDurationMs,
            deviceLookupDurationMs: 0,
            firebaseDurationMs: 0,
            totalDurationMs: Date.now() - totalStartedAt,
            configuredConcurrency: this.getBroadcastConcurrency(),
          }),
          'no_reserved_users',
        );
      }

      const deviceLookupStartedAt = Date.now();
      const devices = await this.prisma.pushDevice.findMany({
        where: {
          userId: {
            in: reservedUserIds,
          },
          enabled: true,
        },
        select: {
          id: true,
          userId: true,
          fcmToken: true,
        },
      });
      const deviceLookupDurationMs = Date.now() - deviceLookupStartedAt;
      const devicesByUserId = this.groupDevicesByUserId(devices);
      const usersWithDevices = reservedUserIds.filter((userId) =>
        devicesByUserId.has(userId),
      );
      const usersWithoutDevices =
        reservedUserIds.length - usersWithDevices.length;
      const deviceCount = devices.length;
      const message = this.buildAppNotificationMessage(payload);

      const firebaseStartedAt = Date.now();
      const configuredConcurrency = this.getBroadcastConcurrency();
      const results = await mapWithConcurrency(
        usersWithDevices,
        configuredConcurrency,
        async (userId) =>
          this.sendBroadcastToUserDevices(
            userId,
            devicesByUserId.get(userId) ?? [],
            message,
          ),
      );
      const firebaseDurationMs = Date.now() - firebaseStartedAt;

      let deviceSendsSucceeded = 0;
      let deviceSendsFailed = 0;
      let invalidTokensDisabled = 0;
      const failureCodes: Record<string, number> = {};

      for (const result of results) {
        if (!result.ok) {
          this.logger.warn(
            `${this.logPrefix()} Broadcast user task failed category=${payload.category} error=${
              result.error instanceof Error
                ? result.error.message
                : String(result.error)
            }`,
          );
          continue;
        }

        deviceSendsSucceeded += result.value.sentCount;
        deviceSendsFailed += result.value.failedCount;
        invalidTokensDisabled += result.value.invalidTokensDisabled;
        mergeFailureCodes(failureCodes, result.value.failureCodes);
      }

      return this.logBroadcastSummary(
        this.buildBroadcastSummary({
          payload,
          requestedUsers: requestedUserIds.length,
          eligibleUsers: eligibleUserIds.length,
          reservedUsers: reservedUserIds.length,
          duplicateUsersSkipped: reservation.skippedDuplicates,
          rateLimitedOrFilteredUsers,
          usersWithDevices: usersWithDevices.length,
          usersWithoutDevices,
          deviceCount,
          deviceSendsSucceeded,
          deviceSendsFailed,
          invalidTokensDisabled,
          failureCodes,
          reservationDurationMs,
          deviceLookupDurationMs,
          firebaseDurationMs,
          totalDurationMs: Date.now() - totalStartedAt,
          configuredConcurrency,
        }),
      );
    } finally {
      stopTimer();
    }
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

  private groupDevicesByUserId(devices: BroadcastPushDevice[]) {
    const devicesByUserId = new Map<string, BroadcastPushDevice[]>();
    for (const device of devices) {
      const existing = devicesByUserId.get(device.userId);
      if (existing) {
        existing.push(device);
      } else {
        devicesByUserId.set(device.userId, [device]);
      }
    }
    return devicesByUserId;
  }

  private async sendBroadcastToUserDevices(
    userId: string,
    devices: BroadcastPushDevice[],
    payload: Omit<Message, 'token'>,
  ): Promise<BroadcastUserSendResult> {
    const messaging = getMessaging(this.firebaseApp);
    let sentCount = 0;
    let failedCount = 0;
    let invalidTokensDisabled = 0;
    const failureCodes: Record<string, number> = {};

    for (const device of devices) {
      try {
        await messaging.send({
          ...payload,
          token: device.fcmToken,
        });
        sentCount += 1;
        this.observability.recordPushDelivery('success');
      } catch (error) {
        failedCount += 1;
        this.observability.recordPushDelivery('failure');
        const code = getFirebaseErrorCode(error);
        incrementFailureCode(failureCodes, code);
        this.logger.warn(
          `${this.logPrefix()} push_send_failed code=${code} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
        );

        if (isInvalidTokenError(error)) {
          const disabled = await this.disableInvalidBroadcastPushToken(
            userId,
            device,
          );
          if (disabled) {
            invalidTokensDisabled += 1;
          }
        }
      }
    }

    return {
      userId,
      deviceCount: devices.length,
      sentCount,
      failedCount,
      invalidTokensDisabled,
      failureCodes,
    };
  }

  private async disableInvalidBroadcastPushToken(
    userId: string,
    device: BroadcastPushDevice,
  ): Promise<boolean> {
    try {
      await this.prisma.pushDevice.update({
        where: { id: device.id },
        data: {
          enabled: false,
          lastSeenAt: new Date(),
        },
      });
      this.logger.warn(
        `${this.logPrefix()} Disabled invalid push token userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `${this.logPrefix()} Failed to disable invalid push token userId=${userId} deviceId=${device.id} tokenSuffix=${this.maskToken(device.fcmToken)}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return false;
    }
  }

  private buildBroadcastSummary(input: {
    payload: AppPushNotificationPayload;
    requestedUsers: number;
    eligibleUsers: number;
    reservedUsers: number;
    duplicateUsersSkipped: number;
    rateLimitedOrFilteredUsers: number;
    usersWithDevices: number;
    usersWithoutDevices: number;
    deviceCount: number;
    deviceSendsSucceeded: number;
    deviceSendsFailed: number;
    invalidTokensDisabled: number;
    failureCodes?: Record<string, number>;
    reservationDurationMs: number;
    deviceLookupDurationMs: number;
    firebaseDurationMs: number;
    totalDurationMs: number;
    configuredConcurrency: number;
  }): AppPushBroadcastSummary {
    return {
      category: input.payload.category,
      entityId: normalizePushEntityId(input.payload.entityId),
      requestedUsers: input.requestedUsers,
      eligibleUsers: input.eligibleUsers,
      reservedUsers: input.reservedUsers,
      duplicateUsersSkipped: input.duplicateUsersSkipped,
      rateLimitedOrFilteredUsers: input.rateLimitedOrFilteredUsers,
      usersWithDevices: input.usersWithDevices,
      usersWithoutDevices: input.usersWithoutDevices,
      deviceCount: input.deviceCount,
      deviceSendsSucceeded: input.deviceSendsSucceeded,
      deviceSendsFailed: input.deviceSendsFailed,
      invalidTokensDisabled: input.invalidTokensDisabled,
      failureCodes: input.failureCodes ?? {},
      reservationDurationMs: input.reservationDurationMs,
      deviceLookupDurationMs: input.deviceLookupDurationMs,
      firebaseDurationMs: input.firebaseDurationMs,
      totalDurationMs: input.totalDurationMs,
      configuredConcurrency: input.configuredConcurrency,
      userCount: input.reservedUsers,
      sentCount: input.deviceSendsSucceeded,
      failedCount: input.deviceSendsFailed,
    };
  }

  private logBroadcastSummary(
    summary: AppPushBroadcastSummary,
    reason?: string,
  ) {
    this.logger.log(
      `${this.logPrefix()} Push broadcast summary category=${summary.category} entityId=${
        summary.entityId || 'none'
      } requestedUsers=${summary.requestedUsers} eligibleUsers=${summary.eligibleUsers} reservedUsers=${summary.reservedUsers} duplicateUsersSkipped=${summary.duplicateUsersSkipped} rateLimitedOrFilteredUsers=${summary.rateLimitedOrFilteredUsers} usersWithDevices=${summary.usersWithDevices} usersWithoutDevices=${summary.usersWithoutDevices} deviceCount=${summary.deviceCount} deviceSendsSucceeded=${summary.deviceSendsSucceeded} deviceSendsFailed=${summary.deviceSendsFailed} invalidTokensDisabled=${summary.invalidTokensDisabled} failureCodes=${formatFailureCodes(summary.failureCodes)} configuredConcurrency=${summary.configuredConcurrency} reservationDurationMs=${summary.reservationDurationMs} deviceLookupDurationMs=${summary.deviceLookupDurationMs} firebaseDurationMs=${summary.firebaseDurationMs} totalDurationMs=${summary.totalDurationMs}${
        reason ? ` reason=${reason}` : ''
      }`,
    );
    return summary;
  }

  private async isPushNotificationsEnabled(): Promise<boolean> {
    return this.notificationConfigService.isPushNotificationsEnabled();
  }

  private getBroadcastConcurrency(): number {
    const raw = this.configService.get<string | number>(
      'PUSH_BROADCAST_CONCURRENCY',
    );

    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;

    if (!Number.isFinite(parsed)) {
      return 15;
    }

    const rounded = Math.trunc(parsed);
    if (rounded < 1) {
      return 1;
    }
    if (rounded > 50) {
      return 50;
    }
    return rounded;
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
      `${this.logPrefix()} Dispatching ${this.describeCategory(payload.category)} push route=${
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

  private logPrefix(): string {
    return `requestId=${this.requestContext.getRequestIdForLog()}`;
  }
}
