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
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthGuard } from './../src/auth/auth.guard.js';
import {
  MailOutboxEnvelopeService,
  type SealedMailEnvelope,
} from './../src/auth/mail-outbox-envelope.service.js';
import { AppModule } from './../src/app.module.js';
import { configureApiApplication } from './../src/bootstrap/api-application.js';

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
  let app: INestApplication | undefined;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    })
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const application = moduleFixture.createNestApplication({
      bodyParser: false,
    });
    configureApiApplication(application);
    await application.init();
    app = application;
  });

  const server = (): Server => {
    if (!app) throw new Error('Test application is not initialized');
    return app.getHttpServer() as Server;
  };

  it('does not expose the scaffold root route', () => {
    return request(server()).get('/api/v1').expect(404);
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
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect('Vary', /Origin/)
      .expect(200);

    await request(server())
      .get('/api/v1/health/live')
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
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'valid', role: 'admin' })
      .expect(400);

    await request(server())
      .post('/api/v1/validation-probe')
      .set('Origin', 'http://localhost:3000')
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
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'a'.repeat(10_001) })
      .expect(413);
  });

  it('sets API security headers without assuming the TLS termination point', () => {
    return request(server())
      .get('/api/v1/health/live')
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
      .get('/api/v1/health/live')
      .set('X-Request-ID', 'request_123')
      .expect('X-Request-ID', 'request_123');

    await request(server())
      .get('/api/v1/health/live')
      .set('X-Request-ID', '<script>')
      .expect('X-Request-ID', /^(?!<script>$)[A-Za-z0-9_-]+$/);
  });

  it('continues a valid trace ID and rejects zero trace context', async () => {
    const traceId = '0123456789abcdef0123456789abcdef';
    await request(server())
      .get('/api/v1/health/live')
      .set('traceparent', `00-${traceId}-0123456789abcdef-01`)
      .expect('traceparent', new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));

    await request(server())
      .get('/api/v1/health/live')
      .set('traceparent', `00-${'0'.repeat(32)}-${'0'.repeat(16)}-01`)
      .expect('traceparent', /^(?!00-0{32}-)[a-f0-9-]+$/);
  });

  it('normalizes validation, not-found and unexpected errors without leaking details', async () => {
    await request(server())
      .post('/api/v1/validation-probe')
      .set('Origin', 'http://localhost:3000')
      .send({ name: 123 })
      .expect(400)
      .expect(({ body }) => {
        const error = (body as BoundaryErrorResponse).error;
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.requestId).toBeTruthy();
      });

    await request(server())
      .post('/api/v1/validation-probe')
      .set('Origin', 'http://localhost:3000')
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

describe('Auth runtime (e2e)', () => {
  let app: INestApplication;
  let source: DataSource;
  let envelopes: MailOutboxEnvelopeService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApiApplication(app);
    await app.init();
    source = app.get(DataSource);
    envelopes = app.get(MailOutboxEnvelopeService);
  });

  it('enforces CSRF and completes the cookie authentication lifecycle', async () => {
    const agent = request.agent(app.getHttpServer() as Server);
    const origin = 'http://localhost:3000';
    const email = 'runtime-auth@example.test';
    const password = 'runtime-password-123';

    await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email, password })
      .expect(403)
      .expect(({ body }) => {
        expect((body as BoundaryErrorResponse).error.code).toBe('FORBIDDEN');
      });

    const csrfResponse = await agent
      .get('/api/v1/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    expect(csrfResponse.headers['cache-control']).toBe('no-store');
    const preauthCsrf = (csrfResponse.body as { csrfToken: string }).csrfToken;

    await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', preauthCsrf)
      .send({ email, password })
      .expect(403)
      .expect(({ body }) => {
        expect((body as BoundaryErrorResponse).error.code).toBe(
          'ORIGIN_NOT_ALLOWED',
        );
      });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', preauthCsrf)
      .set('Cookie', [
        `cs_preauth_csrf=${preauthCsrf}`,
        `cs_preauth_csrf=${preauthCsrf}`,
      ])
      .send({ email, password })
      .expect(403);

    await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', preauthCsrf)
      .send({ email, password })
      .expect(202)
      .expect({ accepted: true });

    const verification = await latestActionValue(
      source,
      envelopes,
      email,
      'verify_email',
    );
    await agent
      .post('/api/v1/auth/verify-email')
      .set('Origin', origin)
      .set('X-CSRF-Token', preauthCsrf)
      .send({ token: verification })
      .expect(200)
      .expect({ accepted: true });

    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', preauthCsrf)
      .send({ email, password })
      .expect(200);
    expect(login.body).toMatchObject({
      user: { email, status: 'active', role: 'user' },
    });
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    const sessionCsrf = responseCookie(login.headers, 'cs_csrf');

    const me = await agent
      .get('/api/v1/auth/me')
      .set('Origin', origin)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ user: { email, status: 'active' } });
      });
    expect(me.headers['cache-control']).toBe('private, no-store');
    expect(me.headers.vary).toContain('Cookie');

    await agent.get('/api/v1/auth/csrf').set('Origin', origin).expect(200);

    const refresh = await agent
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('X-CSRF-Token', sessionCsrf)
      .expect(200)
      .expect({ refreshed: true });
    const rotatedCsrf = responseCookie(refresh.headers, 'cs_csrf');

    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', rotatedCsrf)
      .expect(204);
    await agent.get('/api/v1/auth/me').set('Origin', origin).expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});

async function latestActionValue(
  source: DataSource,
  envelopes: MailOutboxEnvelopeService,
  email: string,
  purpose: 'reset_password' | 'verify_email',
): Promise<string> {
  const eventType =
    purpose === 'verify_email'
      ? 'identity.mail.verification.requested'
      : 'identity.mail.password.reset.requested';
  const rows: unknown = await source.query(
    `SELECT event.aggregate_id AS "userId", event.payload
     FROM outbox_events event JOIN users u ON u.id = event.aggregate_id
     WHERE u.email_normalized = $1 AND event.event_type = $2
     ORDER BY event.created_at DESC, event.id DESC LIMIT 1`,
    [email, eventType],
  );
  if (!Array.isArray(rows) || !rows[0]) throw new Error('Missing auth action');
  const row = rows[0] as {
    readonly userId: string;
    readonly payload: { readonly sealed: SealedMailEnvelope };
  };
  return envelopes.open(row.payload.sealed, {
    userId: row.userId,
    purpose,
    eventType,
    eventVersion: 1,
  }).actionValue;
}

function responseCookie(
  headers: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const values = headers['set-cookie'];
  if (!Array.isArray(values)) throw new Error('Missing Set-Cookie headers');
  const cookie = values.find(
    (value): value is string =>
      typeof value === 'string' && value.startsWith(`${name}=`),
  );
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.slice(name.length + 1).split(';', 1)[0]!;
}
