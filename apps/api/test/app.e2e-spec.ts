import { Test, TestingModule } from '@nestjs/testing';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Query,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiApplication } from './../src/bootstrap/api-application';

class ValidationProbeDto {
  @IsString()
  @MaxLength(100)
  name!: string;
}

interface BoundaryErrorResponse {
  readonly error: { readonly code: string; readonly requestId: string };
}

@Controller('validation-probe')
class ValidationProbeController {
  @Get()
  get(@Query('page') page?: string) {
    return { page };
  }

  @Post()
  create(@Body() body: ValidationProbeDto) {
    return body;
  }

  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error(
      'password=hunter2 token=secret https://internal.example/private',
    );
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App> | undefined;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    }).compile();

    const application = moduleFixture.createNestApplication({
      bodyParser: false,
    });
    configureApiApplication(application);
    await application.init();
    app = application;
  });

  const server = () => {
    if (!app) throw new Error('Test application is not initialized');
    return app.getHttpServer();
  };

  it('/api/v1 (GET)', () => {
    return request(server()).get('/api/v1').expect(200).expect('Hello World!');
  });

  it('exposes distinct liveness and readiness endpoints', async () => {
    await request(server())
      .get('/api/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    await request(server())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('allows the exact web origin and rejects a spoofed origin', async () => {
    await request(server())
      .get('/api/v1')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect('Vary', /Origin/)
      .expect(200);

    await request(server())
      .get('/api/v1')
      .set('Origin', 'http://localhost:3000.evil.example')
      .expect(403)
      .expect(({ body }) => {
        const error = (body as BoundaryErrorResponse).error;
        expect(error.code).toBe('ORIGIN_NOT_ALLOWED');
        expect(error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
      });
  });

  it('rejects unknown DTO fields and unsupported content types', async () => {
    await request(server())
      .post('/api/v1/validation-probe')
      .send({ name: 'valid', role: 'admin' })
      .expect(400);

    await request(server())
      .post('/api/v1/validation-probe')
      .set('Content-Type', 'text/plain')
      .send('name=valid')
      .expect(415);
  });

  it('rejects duplicate query parameters and complex bodies', async () => {
    await request(server())
      .get('/api/v1/validation-probe?page=1&page=2')
      .expect(400)
      .expect(({ body }) => {
        expect((body as BoundaryErrorResponse).error.code).toBe(
          'DUPLICATE_QUERY_PARAMETER',
        );
      });

    await request(server())
      .post('/api/v1/validation-probe')
      .send({ name: 'a'.repeat(10_001) })
      .expect(413);
  });

  it('sets API security headers without assuming the TLS termination point', () => {
    return request(server())
      .get('/api/v1')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('X-Frame-Options', 'SAMEORIGIN')
      .expect('X-Request-ID', /^[A-Za-z0-9_-]+$/)
      .expect((response) => {
        expect(response.headers['strict-transport-security']).toBeUndefined();
        expect(response.headers['x-powered-by']).toBeUndefined();
      });
  });

  it('keeps a valid request ID and replaces an unsafe value', async () => {
    await request(server())
      .get('/api/v1')
      .set('X-Request-ID', 'request_123')
      .expect('X-Request-ID', 'request_123');

    await request(server())
      .get('/api/v1')
      .set('X-Request-ID', '<script>')
      .expect('X-Request-ID', /^(?!<script>$)[A-Za-z0-9_-]+$/);
  });

  it('continues a valid trace ID and rejects zero trace context', async () => {
    const traceId = '0123456789abcdef0123456789abcdef';
    await request(server())
      .get('/api/v1')
      .set('traceparent', `00-${traceId}-0123456789abcdef-01`)
      .expect('traceparent', new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));

    await request(server())
      .get('/api/v1')
      .set('traceparent', `00-${'0'.repeat(32)}-${'0'.repeat(16)}-01`)
      .expect('traceparent', /^(?!00-0{32}-)[a-f0-9-]+$/);
  });

  it('normalizes validation, not-found and unexpected errors without leaking details', async () => {
    await request(server())
      .post('/api/v1/validation-probe')
      .send({ name: 123 })
      .expect(400)
      .expect(({ body }) => {
        const error = (body as BoundaryErrorResponse).error;
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.requestId).toBeTruthy();
      });

    await request(server())
      .post('/api/v1/validation-probe')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400)
      .expect(({ body }) => {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('Unexpected end');
        expect((body as BoundaryErrorResponse).error.code).toBe(
          'VALIDATION_FAILED',
        );
      });

    await request(server())
      .get('/api/v1/missing?token=secret')
      .expect(404)
      .expect(({ body }) => {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('token=secret');
        expect((body as BoundaryErrorResponse).error.code).toBe('NOT_FOUND');
      });

    await request(server())
      .get('/api/v1/validation-probe/unexpected-error')
      .expect(500)
      .expect(({ body }) => {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('internal.example');
        expect((body as BoundaryErrorResponse).error.code).toBe(
          'INTERNAL_ERROR',
        );
      });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
});
