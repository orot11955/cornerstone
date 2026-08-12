import type { configuration } from '../config/configuration.js';

export const AUTH_SECURITY_OPTIONS = Symbol('AUTH_SECURITY_OPTIONS');

export type AuthSecurityOptions = ReturnType<typeof configuration>['auth'];

export type VersionedSecret = AuthSecurityOptions['accessToken']['current'];
