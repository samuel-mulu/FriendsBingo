import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { setupApp } from './../src/app.setup';

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-123';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.CBE_ACCOUNT_NUMBER ??= '1002003004005006';
process.env.CBE_ACCOUNT_LAST8 ??= '40005006';
process.env.TELEBIRR_RECEIVER_PHONE ??= '0911002200';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';

// AppModule validates env vars during import, so test defaults must exist first.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./../src/app.module');

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('ok');
        expect(response.body.data.database).toBe('up');
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
