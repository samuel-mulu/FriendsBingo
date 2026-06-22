import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { setupApp } from './../src/app.setup';

process.env.NODE_ENV ??= 'test';
process.env.FIREBASE_PROJECT_ID ??= 'friends-bingo-test';
process.env.FIREBASE_CLIENT_EMAIL ??=
  'firebase-adminsdk-test@friends-bingo-test.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY ??=
  '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n';
process.env.JWT_SECRET ??= 'test-jwt-secret-123';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.CBE_ACCOUNT_NUMBER ??= '1002003004005006';
process.env.CBE_ACCOUNT_LAST8 ??= '40005006';
process.env.TELEBIRR_RECEIVER_PHONE ??= '0911002200';
process.env.TELEBIRR_SETTLEMENT_ACCOUNT ??= '0962520885';
process.env.VERIFY_ET_API_KEY ??= 'verify-et-test-key';
process.env.VERIFY_ET_BASE_URL ??= 'https://verify.et';
process.env.VERIFY_ET_WAIT_MS ??= '5000';
process.env.VERIFY_ET_POLL_ATTEMPTS ??= '10';
process.env.VERIFY_ET_POLL_INTERVAL_MS ??= '1500';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.ANDROID_LATEST_VERSION ??= '2.4.1';
process.env.ANDROID_LATEST_VERSION_CODE ??= '5';
process.env.ANDROID_MINIMUM_VERSION_CODE ??= '3';
process.env.ANDROID_APK_DOWNLOAD_URL ??=
  'https://github.com/samuel-mulu/friends-admin-dahsboard/releases/download/v1.1.1/app-release.apk';
process.env.ANDROID_APK_SHA256 ??=
  'c5ae01a502cc64e840b452537b19b73c52a7b5c6507661ec1334bf6ab4a090ff';
process.env.ANDROID_RELEASE_NOTES ??= 'Initial public Android release';
process.env.ANDROID_FORCE_UPDATE ??= 'false';

// AppModule validates env vars during import, so test defaults must exist first.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./../src/app.module');

describe('AppVersionController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/app-version/android (GET) returns configured version', () => {
    return request(app.getHttpServer())
      .get('/app-version/android')
      .expect(200)
      .expect((response) => {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({
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
  });

  it('/app-version/android (GET) sets cache-control header', () => {
    return request(app.getHttpServer())
      .get('/app-version/android')
      .expect(200)
      .expect((response) => {
        expect(response.headers['cache-control']).toBe('no-store');
      });
  });
});
