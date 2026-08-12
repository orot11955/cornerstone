import {
  HttpStatus,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import { requestContextMiddleware } from '../observability/request-context';

const API_PREFIX = 'api/v1';
const BODY_LIMIT = 1024 * 1024;
const MAX_BODY_DEPTH = 10;
const MAX_BODY_FIELDS = 200;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 10_000;
const MAX_QUERY_FIELDS = 100;
const MAX_QUERY_KEY_LENGTH = 200;
const MAX_QUERY_VALUE_LENGTH = 2_000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function configureApiApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const webOrigin = new URL(config.getOrThrow<string>('app.webUrl')).origin;
  const trustProxyHops = config.getOrThrow<number>('app.trustProxyHops');
  const expressApplication = app.getHttpAdapter().getInstance() as Application;

  expressApplication.disable('x-powered-by');
  expressApplication.set('query parser', 'simple');
  expressApplication.set(
    'trust proxy',
    trustProxyHops > 0 ? trustProxyHops : false,
  );

  app.use(requestContextMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(enforceOrigin(webOrigin));
  app.use(enforceJsonContentType);
  app.use(
    express.json({
      limit: BODY_LIMIT,
      strict: true,
      type: ['application/json', 'application/*+json'],
    }),
  );
  app.use(cookieParser());
  app.use(enforceRequestShape);
  app.enableCors({
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'If-Match',
      'X-CSRF-Token',
      'X-Request-ID',
    ],
    exposedHeaders: ['ETag', 'Retry-After', 'X-Request-ID'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.enableShutdownHooks();
}

function enforceOrigin(allowedOrigin: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.get('origin');
    if (!origin || origin === allowedOrigin) {
      next();
      return;
    }
    sendBoundaryError(response, HttpStatus.FORBIDDEN, 'ORIGIN_NOT_ALLOWED');
  };
}

function enforceJsonContentType(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const contentLength = Number(request.get('content-length') ?? 0);
  const hasBody =
    (Number.isFinite(contentLength) && contentLength > 0) ||
    request.get('transfer-encoding') !== undefined;
  if (
    !UNSAFE_METHODS.has(request.method) ||
    !hasBody ||
    request.is(['application/json', 'application/*+json'])
  ) {
    next();
    return;
  }
  sendBoundaryError(
    response,
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'UNSUPPORTED_CONTENT_TYPE',
  );
}

function enforceRequestShape(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const queryError = validateQuery(request.originalUrl);
  if (queryError) {
    sendBoundaryError(response, HttpStatus.BAD_REQUEST, queryError);
    return;
  }
  const bodyError = validateBody(request.body);
  if (bodyError) {
    sendBoundaryError(response, HttpStatus.PAYLOAD_TOO_LARGE, bodyError);
    return;
  }
  next();
}

function validateQuery(originalUrl: string): string | undefined {
  const rawQuery = originalUrl.split('?', 2)[1];
  if (!rawQuery) return undefined;
  const query = new URLSearchParams(rawQuery);
  if ([...query].length > MAX_QUERY_FIELDS) return 'QUERY_TOO_COMPLEX';
  const keys = new Set<string>();
  for (const [key, value] of query) {
    if (
      !key ||
      key.length > MAX_QUERY_KEY_LENGTH ||
      value.length > MAX_QUERY_VALUE_LENGTH
    ) {
      return 'QUERY_TOO_COMPLEX';
    }
    if (keys.has(key)) return 'DUPLICATE_QUERY_PARAMETER';
    keys.add(key);
  }
  return undefined;
}

function validateBody(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const state = { fields: 0 };

  function visit(item: unknown, depth: number): string | undefined {
    if (depth > MAX_BODY_DEPTH) return 'BODY_TOO_COMPLEX';
    if (typeof item === 'string' && item.length > MAX_STRING_LENGTH)
      return 'BODY_TOO_COMPLEX';
    if (Array.isArray(item)) {
      if (item.length > MAX_ARRAY_ITEMS) return 'BODY_TOO_COMPLEX';
      for (const child of item) {
        const error = visit(child, depth + 1);
        if (error) return error;
      }
      return undefined;
    }
    if (typeof item !== 'object' || item === null) return undefined;
    for (const [key, child] of Object.entries(item)) {
      state.fields += 1;
      if (state.fields > MAX_BODY_FIELDS) return 'BODY_TOO_COMPLEX';
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        return 'PROTOTYPE_KEY_REJECTED';
      const error = visit(child, depth + 1);
      if (error) return error;
    }
    return undefined;
  }

  return visit(value, 0);
}

function sendBoundaryError(
  response: Response,
  status: number,
  code: string,
): void {
  const requestId = response.locals.requestId as string | undefined;
  response.status(status).json({
    error: {
      code,
      message: 'The request was rejected by the API boundary.',
      ...(requestId ? { requestId } : {}),
    },
  });
}
