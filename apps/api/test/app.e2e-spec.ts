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
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApiApplication(app);
    await app.init();
  });

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Hello World!');
  });

  it('allows the exact web origin and rejects a spoofed origin', async () => {
    await request(app.getHttpServer())
      .get('/api/v1')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect('Vary', /Origin/)
      .expect(200);

    await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .post('/api/v1/validation-probe')
      .send({ name: 'valid', role: 'admin' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/validation-probe')
      .set('Content-Type', 'text/plain')
      .send('name=valid')
      .expect(415);
  });

  it('rejects duplicate query parameters and complex bodies', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/validation-probe?page=1&page=2')
      .expect(400)
      .expect(({ body }) => {
        expect((body as BoundaryErrorResponse).error.code).toBe(
          'DUPLICATE_QUERY_PARAMETER',
        );
      });

    await request(app.getHttpServer())
      .post('/api/v1/validation-probe')
      .send({ name: 'a'.repeat(10_001) })
      .expect(413);
  });

  it('sets API security headers without assuming the TLS termination point', () => {
    return request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-ID', 'request_123')
      .expect('X-Request-ID', 'request_123');

    await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-ID', '<script>')
      .expect('X-Request-ID', /^(?!<script>$)[A-Za-z0-9_-]+$/);
  });

  afterEach(async () => {
    await app.close();
  });
});
