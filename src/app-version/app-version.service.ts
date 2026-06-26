import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AndroidAppVersionResponse {
  version: string;
  versionCode: number;
  minimumVersionCode: number;
  downloadUrl: string;
  sha256: string;
  releaseNotes: string;
  forceUpdate: boolean;
}

@Injectable()
export class AppVersionService implements OnModuleInit {
  private readonly logger = new Logger(AppVersionService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const config = this.getAndroidVersion();
    this.logger.log(
      `Android app version policy: latest=${config.version} (build ${config.versionCode}), ` +
        `minimum build ${config.minimumVersionCode}, forceUpdate=${config.forceUpdate}`,
    );
  }

  getAndroidVersion(): AndroidAppVersionResponse {
    const version =
      this.configService.get<string>('ANDROID_LATEST_VERSION') ?? '1.0.1';
    const versionCode = this.readPositiveInt('ANDROID_LATEST_VERSION_CODE', 2);
    let minimumVersionCode = this.readPositiveInt(
      'ANDROID_MINIMUM_VERSION_CODE',
      1,
    );
    const downloadUrl =
      this.configService.get<string>('ANDROID_APK_DOWNLOAD_URL') ?? '';
    const sha256 = this.configService.get<string>('ANDROID_APK_SHA256') ?? '';
    const releaseNotes =
      this.configService.get<string>('ANDROID_RELEASE_NOTES') ?? '';
    const forceUpdate = this.readBoolean('ANDROID_FORCE_UPDATE', false);

    if (minimumVersionCode > versionCode) {
      this.logger.warn(
        `ANDROID_MINIMUM_VERSION_CODE (${minimumVersionCode}) exceeds ANDROID_LATEST_VERSION_CODE (${versionCode}); clamping minimum to latest.`,
      );
      minimumVersionCode = versionCode;
    }

    return {
      version,
      versionCode,
      minimumVersionCode,
      downloadUrl,
      sha256,
      releaseNotes,
      forceUpdate,
    };
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.trunc(parsed);
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const raw = this.configService.get<string | boolean>(key);
    if (typeof raw === 'boolean') {
      return raw;
    }

    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return fallback;
  }
}
