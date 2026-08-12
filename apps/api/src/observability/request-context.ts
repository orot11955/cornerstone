import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';
import { StructuredLogger } from './structured-logger.service.js';

export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const suppliedRequestId = request.get('x-request-id');
  const requestId =
    suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
  const traceId = resolveTraceId(request.get('traceparent')) ?? randomHex(16);
  const responseTraceparent = `00-${traceId}-${randomHex(8)}-01`;
  response.setHeader('X-Request-ID', requestId);
  response.setHeader('traceparent', responseTraceparent);
  response.locals.requestId = requestId;
  requestContext.run({ requestId, traceId }, next);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function requestLifecycleMiddleware(
  metrics: MetricsService,
  logger: StructuredLogger,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    response.once('finish', () => {
      const durationMs = performance.now() - startedAt;
      const routeId =
        readSafeResponseValue(response, 'routeId') ??
        `${request.method} BOUNDARY`;
      const errorType = readSafeResponseValue(response, 'errorType');
      const context = getRequestContext();
      metrics.recordHttp(routeId, response.statusCode, durationMs);
      logger.event(
        response.statusCode >= 500
          ? 'error'
          : response.statusCode >= 400
            ? 'warn'
            : 'info',
        'http.request.completed',
        {
          routeId,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          requestId: context?.requestId,
          traceId: context?.traceId,
          ...(errorType ? { errorType } : {}),
        },
      );
    });
    next();
  };
}

function randomHex(bytes: number): string {
  return randomUUID()
    .replaceAll('-', '')
    .slice(0, bytes * 2);
}

function resolveTraceId(value: string | undefined): string | undefined {
  const match = value?.match(SAFE_TRACEPARENT);
  if (!match) return undefined;
  const traceId = match[1];
  const parentId = match[2];
  if (!traceId || !parentId || /^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return undefined;
  }
  return traceId;
}

function readSafeResponseValue(
  response: Response,
  key: string,
): string | undefined {
  const value: unknown = response.locals[key];
  return typeof value === 'string' ? value : undefined;
}
