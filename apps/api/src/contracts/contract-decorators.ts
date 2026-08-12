import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { ApiErrorResponseDto } from './common.dto.js';

export function ApiStandardErrors(...statuses: number[]): MethodDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, type: ApiErrorResponseDto }),
    ),
  );
}

export function ApiCsrfHeader(): MethodDecorator {
  return ApiHeader({
    name: 'X-CSRF-Token',
    required: true,
    description: 'Session-bound CSRF token.',
  });
}

export function ApiOptimisticMutation(): MethodDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'If-Match',
      required: true,
      description: 'Strong numeric ETag, for example "3".',
    }),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'Visible ASCII key scoped to the authenticated principal.',
    }),
    ApiCsrfHeader(),
  );
}
