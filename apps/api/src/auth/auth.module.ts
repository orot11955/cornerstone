import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { AuthCryptoModule } from './auth-crypto.module.js';
import { createAuthCookiePolicy } from './auth-cookie.policy.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthLifecycleService } from './auth-lifecycle.service.js';
import { AUTH_COOKIE_POLICY } from './auth.tokens.js';

@Module({
  imports: [AuthCryptoModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthLifecycleService,
    AuthGuard,
    {
      provide: AUTH_COOKIE_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAuthCookiePolicy(
          config.getOrThrow<'development' | 'production' | 'test'>(
            'app.environment',
          ),
        ),
    },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [AuthLifecycleService],
})
export class AuthModule {}
