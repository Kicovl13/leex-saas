import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('GET /public/matters/:token with invalid token returns 404', () => {
    return request(app.getHttpServer())
      .get('/public/matters/invalid-token-12345')
      .expect(404);
  });

  it('GET /health returns 200 or 503', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect([200, 503]).toContain(res.status);
  });

  it('POST /internal/documents/ai-result sin token devuelve 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/documents/ai-result')
      .send({
        documentId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        status: 'completed',
        aiMetadata: { summary: 'ok' },
      });
    // 401 si INTERNAL_WEBHOOK_TOKEN está configurado; 503 si no
    expect([401, 503]).toContain(res.status);
  });
});
