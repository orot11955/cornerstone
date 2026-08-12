import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestContext {
  readonly requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  response.setHeader('X-Request-ID', requestId);
  response.locals.requestId = requestId;
  requestContext.run({ requestId }, next);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
