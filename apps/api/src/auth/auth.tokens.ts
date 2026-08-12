import type { AuthCookiePolicy } from './auth-cookie.policy.js';

export const AUTH_COOKIE_POLICY = Symbol('AUTH_COOKIE_POLICY');
export type RuntimeAuthCookiePolicy = AuthCookiePolicy;
