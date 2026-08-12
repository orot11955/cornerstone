import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'not-ready'] })
  status!: 'ok' | 'not-ready';
}
