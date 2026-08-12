import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../contracts/common.dto.js';
import { AuthorizeRoute } from '../authorization/route-policy.decorator.js';
import { HealthResponseDto } from './health.dto.js';
import { HealthService, type HealthStatus } from './health.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @AuthorizeRoute('getLiveness')
  @ApiOperation({ operationId: 'getLiveness' })
  @ApiOkResponse({ type: HealthResponseDto })
  liveness(): HealthStatus {
    return this.health.liveness();
  }

  @Get('ready')
  @AuthorizeRoute('getReadiness')
  @ApiOperation({ operationId: 'getReadiness' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  readiness(): Promise<HealthStatus> {
    return this.health.readiness();
  }
}
