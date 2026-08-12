import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import {
  invalidCredentials,
  rateLimited,
  serviceUnavailable,
} from '../auth/auth-lifecycle.error.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter auth mapping', () => {
  it.each([
    [
      invalidCredentials(),
      401,
      'INVALID_CREDENTIALS',
      'The request could not be processed.',
    ],
    [
      rateLimited(17),
      429,
      'RATE_LIMITED',
      'The request could not be processed.',
    ],
    [
      serviceUnavailable(),
      503,
      'SERVICE_UNAVAILABLE',
      'The server could not complete the request.',
    ],
  ] as const)(
    'maps lifecycle errors to their public status',
    (error, status, code, message) => {
      const response = responseFixture();
      new ApiExceptionFilter().catch(error, hostFixture(response.value));

      expect(response.record.status).toBe(status);
      expect(response.record.body).toEqual({
        error: {
          code,
          message,
          requestId: 'unavailable',
        },
      });
    },
  );

  it('emits a bounded Retry-After value for rate limits', () => {
    const response = responseFixture();
    new ApiExceptionFilter().catch(
      rateLimited(23),
      hostFixture(response.value),
    );

    expect(response.record.headers).toEqual({ 'Retry-After': '23' });
  });
});

function responseFixture() {
  const record: {
    status?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { headers: {} };
  const response = {
    locals: {},
    status(value: number) {
      record.status = value;
      return response;
    },
    json(value: unknown) {
      record.body = value;
      return response;
    },
    setHeader(name: string, value: string) {
      record.headers[name] = value;
      return response;
    },
  };
  return { value: response as unknown as Response, record };
}

function hostFixture(response: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost;
}
