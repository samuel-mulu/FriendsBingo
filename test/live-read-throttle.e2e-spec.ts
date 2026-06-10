import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { setupApp } from '../src/app.setup';

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-123';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.CBE_ACCOUNT_NUMBER ??= '1002003004005006';
process.env.CBE_ACCOUNT_LAST8 ??= '40005006';
process.env.TELEBIRR_RECEIVER_PHONE ??= '0911002200';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.OTP_ALLOW_MOCK ??= 'true';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');

describe('Live read throttle exemptions (e2e)', () => {
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

  it(
    'GET /games/operations/current stays available under rapid polling',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 25 }, () =>
          request(app.getHttpServer()).get('/games/operations/current'),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(200);
      }
    },
    60_000,
  );

  it('GET /games/sessions/:id/called-numbers stays available under rapid polling', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await request(app.getHttpServer())
        .get(`/games/sessions/${sessionId}/called-numbers`)
        .expect((response) => {
          expect([200, 404]).toContain(response.status);
        });
    }
  });

  it('still enforces auth throttler on login after live-read polling', async () => {
    const credentials = {
      phoneNumber: '0999999992',
      password: 'wrong-password-2',
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send(credentials)
        .expect((response) => {
          expect([401, 429]).toContain(response.status);
        });
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send(credentials)
      .expect(429);
  });
});
