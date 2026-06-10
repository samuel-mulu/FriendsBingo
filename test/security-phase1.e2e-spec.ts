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

describe('Security phase 1 (e2e)', () => {
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

  it('GET /cartelas returns numbers without board values', async () => {
    const response = await request(app.getHttpServer()).get('/cartelas').expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);

    if (response.body.data.length > 0) {
      const first = response.body.data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('number');
      expect(first).not.toHaveProperty('b');
      expect(first).not.toHaveProperty('i');
      expect(first).not.toHaveProperty('n');
      expect(first).not.toHaveProperty('g');
      expect(first).not.toHaveProperty('o');
    }
  });

  it('GET /cartelas/:id/board requires authentication', async () => {
    const catalog = await request(app.getHttpServer()).get('/cartelas').expect(200);
    const cartelaId = catalog.body.data?.[0]?.id;

    if (!cartelaId) {
      return;
    }

    await request(app.getHttpServer())
      .get(`/cartelas/${cartelaId}/board`)
      .query({ sessionId: '00000000-0000-4000-8000-000000000001' })
      .expect(401);
  });

  it('enforces auth throttler on login', async () => {
    const credentials = {
      phoneNumber: '0999999991',
      password: 'wrong-password-1',
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

  it('keeps cartela catalog available after auth throttle is exhausted', async () => {
    await request(app.getHttpServer()).get('/cartelas').expect(200);
  });

  it('enables express trust proxy for reverse-proxy deployments', () => {
    const expressApp = app.getHttpAdapter().getInstance() as {
      get: (setting: string) => unknown;
    };

    expect(expressApp.get('trust proxy')).toBe(1);
  });
});
