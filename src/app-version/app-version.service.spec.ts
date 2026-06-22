import { ConfigService } from '@nestjs/config';
import { AppVersionService } from './app-version.service';

describe('AppVersionService', () => {
  function createService(values: Record<string, string | number | boolean>) {
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return new AppVersionService(configService);
  }

  it('returns configured android version payload', () => {
    const service = createService({
      ANDROID_LATEST_VERSION: '2.4.1',
      ANDROID_LATEST_VERSION_CODE: 5,
      ANDROID_MINIMUM_VERSION_CODE: 3,
      ANDROID_APK_DOWNLOAD_URL:
        'https://github.com/samuel-mulu/friends-admin-dahsboard/releases/download/v1.1.1/app-release.apk',
      ANDROID_APK_SHA256:
        'c5ae01a502cc64e840b452537b19b73c52a7b5c6507661ec1334bf6ab4a090ff',
      ANDROID_RELEASE_NOTES: 'Initial public Android release',
      ANDROID_FORCE_UPDATE: false,
    });

    expect(service.getAndroidVersion()).toEqual({
      version: '2.4.1',
      versionCode: 5,
      minimumVersionCode: 3,
      downloadUrl:
        'https://github.com/samuel-mulu/friends-admin-dahsboard/releases/download/v1.1.1/app-release.apk',
      sha256:
        'c5ae01a502cc64e840b452537b19b73c52a7b5c6507661ec1334bf6ab4a090ff',
      releaseNotes: 'Initial public Android release',
      forceUpdate: false,
    });
  });

  it('coerces numeric versionCode and boolean forceUpdate', () => {
    const service = createService({
      ANDROID_LATEST_VERSION: '2.0.0',
      ANDROID_LATEST_VERSION_CODE: '7',
      ANDROID_MINIMUM_VERSION_CODE: '2',
      ANDROID_APK_DOWNLOAD_URL: '',
      ANDROID_APK_SHA256: '',
      ANDROID_RELEASE_NOTES: '',
      ANDROID_FORCE_UPDATE: 'true',
    });

    const result = service.getAndroidVersion();

    expect(result.versionCode).toBe(7);
    expect(result.minimumVersionCode).toBe(2);
    expect(result.forceUpdate).toBe(true);
  });

  it('clamps minimumVersionCode to versionCode when misconfigured', () => {
    const service = createService({
      ANDROID_LATEST_VERSION: '2.0.0',
      ANDROID_LATEST_VERSION_CODE: 4,
      ANDROID_MINIMUM_VERSION_CODE: 9,
      ANDROID_APK_DOWNLOAD_URL: '',
      ANDROID_APK_SHA256: '',
      ANDROID_RELEASE_NOTES: '',
      ANDROID_FORCE_UPDATE: false,
    });

    expect(service.getAndroidVersion().minimumVersionCode).toBe(4);
  });
});
