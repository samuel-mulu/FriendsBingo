import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { setupApp } from '../src/app.setup';

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-123';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.FIREBASE_PROJECT_ID ??= 'friends-bingo-test';
process.env.FIREBASE_CLIENT_EMAIL ??=
  'firebase-adminsdk-test@friends-bingo-test.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY ??=
  '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');

describe('Notifications endpoints (e2e)', () => {
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
    if (app) {
      await app.close();
    }
  });

  it('rejects unauthenticated device registration', async () => {
    await request(app.getHttpServer())
      .post('/notifications/register-device')
      .send({
        token: 'token-1',
        platform: 'android',
      })
      .expect(401);
  });
});
