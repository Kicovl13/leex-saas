import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InternalDocumentsController } from '../src/modules/documents/internal-documents.controller';
import { DocumentsService } from '../src/modules/documents/documents.service';

describe('InternalDocumentsController (e2e)', () => {
  let app: INestApplication;
  const updateAiProcessingResult = jest.fn();
  const previousToken = process.env.INTERNAL_WEBHOOK_TOKEN;

  beforeAll(async () => {
    process.env.INTERNAL_WEBHOOK_TOKEN = 'test-internal-token';

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalDocumentsController],
      providers: [
        {
          provide: DocumentsService,
          useValue: { updateAiProcessingResult },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    process.env.INTERNAL_WEBHOOK_TOKEN = previousToken;
    await app.close();
  });

  beforeEach(() => {
    updateAiProcessingResult.mockReset();
    updateAiProcessingResult.mockResolvedValue({
      id: 'doc-1',
      organizationId: 'org-1',
      aiSummary: 'Resumen IA',
      aiMetadata: { status: 'completed' },
    });
  });

  it('rechaza callback sin token interno', async () => {
    await request(app.getHttpServer())
      .post('/internal/documents/ai-result')
      .send({
        documentId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        status: 'completed',
        aiMetadata: { summary: 'ok' },
      })
      .expect(401);
  });

  it('acepta callback con token interno válido', async () => {
    const payload = {
      documentId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      status: 'failed',
      aiMetadata: { provider: 'worker', confidence: 0.82 },
      errorMessage: 'timeout',
    };

    const res = await request(app.getHttpServer())
      .post('/internal/documents/ai-result')
      .set('x-internal-token', 'test-internal-token')
      .send(payload)
      .expect(201);

    expect(updateAiProcessingResult).toHaveBeenCalledWith(payload);
    expect(res.body).toMatchObject({
      id: 'doc-1',
      organizationId: 'org-1',
      aiSummary: 'Resumen IA',
      aiMetadata: expect.objectContaining({ status: 'completed' }),
    });
  });
});
