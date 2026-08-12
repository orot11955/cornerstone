import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthCryptoModule } from './auth-crypto.module.js';
import { AuthLifecycleService } from './auth-lifecycle.service.js';

@Module({
  imports: [AuthCryptoModule, DatabaseModule],
  providers: [AuthLifecycleService],
  exports: [AuthLifecycleService],
})
export class AuthModule {}
