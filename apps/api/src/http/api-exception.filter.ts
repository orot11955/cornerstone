import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { getRequestContext } from '../observability/request-context.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestContext = getRequestContext();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const code = statusCode(status);

    response.locals.errorType = safeErrorType(exception);
    response.status(status).json({
      error: {
        code,
        message: statusMessage(status),
        requestId: requestContext?.requestId ?? 'unavailable',
      },
    });
  }
}

function statusCode(status: number): string {
  const codes: Readonly<Record<number, string>> = {
    400: 'VALIDATION_FAILED',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'CONFLICT',
    412: 'PRECONDITION_FAILED',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_CONTENT_TYPE',
    429: 'RATE_LIMITED',
  };
  return (
    codes[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED')
  );
}

function statusMessage(status: number): string {
  if (status === 404) return 'The requested resource was not found.';
  if (status >= 500) return 'The server could not complete the request.';
  return 'The request could not be processed.';
}

function safeErrorType(exception: unknown): string {
  if (!(exception instanceof Error)) return 'UnknownError';
  return /^[A-Za-z0-9_]{1,80}$/.test(exception.name) ? exception.name : 'Error';
}
