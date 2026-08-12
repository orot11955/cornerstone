import { ApiProperty } from '@nestjs/swagger';

export const apiErrorCodes = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_MISMATCH',
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export class ApiErrorDetailDto {
  @ApiProperty({ enum: apiErrorCodes, example: 'VALIDATION_FAILED' })
  code!: (typeof apiErrorCodes)[number];

  @ApiProperty({ example: 'The request could not be processed.' })
  message!: string;

  @ApiProperty({ example: 'request_123', maxLength: 128 })
  requestId!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;
}

export class AcceptedResponseDto {
  @ApiProperty({ example: true })
  accepted!: true;
}
