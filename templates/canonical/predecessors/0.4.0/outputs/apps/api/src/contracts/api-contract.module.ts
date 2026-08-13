import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module.js';
import { AuthContractController } from './auth-contract.controller.js';
import { UserContractController } from './user-contract.controller.js';

@Module({
  imports: [HealthModule],
  controllers: [AuthContractController, UserContractController],
})
export class ApiContractModule {}
