import { Module } from '@nestjs/common';
import { configuration } from '../config/configuration.js';
import { AccessTokenService } from './access-token.service.js';
import { AUTH_SECURITY_OPTIONS } from './auth-security.options.js';
import { CsrfTokenService } from './csrf-token.service.js';
import { MailOutboxEnvelopeService } from './mail-outbox-envelope.service.js';
import { OpaqueTokenService } from './opaque-token.service.js';
import { PasswordService } from './password.service.js';

@Module({
  providers: [
    {
      provide: AUTH_SECURITY_OPTIONS,
      useFactory: () => configuration().auth,
    },
    AccessTokenService,
    CsrfTokenService,
    OpaqueTokenService,
    PasswordService,
    MailOutboxEnvelopeService,
  ],
  exports: [
    AUTH_SECURITY_OPTIONS,
    AccessTokenService,
    CsrfTokenService,
    OpaqueTokenService,
    PasswordService,
    MailOutboxEnvelopeService,
  ],
})
export class AuthCryptoModule {}
