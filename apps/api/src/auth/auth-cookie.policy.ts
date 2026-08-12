import type { CookieOptions } from 'express';

export type AuthCookieKind = 'access' | 'csrf' | 'refresh';

export interface AuthCookieDefinition {
  readonly name: string;
  readonly issue: Readonly<CookieOptions>;
  readonly clear: Readonly<CookieOptions>;
}

export type AuthCookiePolicy = Readonly<
  Record<AuthCookieKind, AuthCookieDefinition>
>;

export interface AuthCookieResponse {
  cookie(name: string, value: string, options: CookieOptions): unknown;
  clearCookie(name: string, options: CookieOptions): unknown;
}

export function createAuthCookiePolicy(
  environment: 'development' | 'production' | 'test',
): AuthCookiePolicy {
  const secure = environment === 'production';
  const prefix = secure ? '__Host-' : '';
  return {
    access: definition(`${prefix}cs_access`, secure, true, 'lax', 600),
    refresh: definition(
      `${prefix}cs_refresh`,
      secure,
      true,
      'strict',
      30 * 24 * 60 * 60,
    ),
    csrf: definition(
      `${prefix}cs_csrf`,
      secure,
      false,
      'strict',
      30 * 24 * 60 * 60,
    ),
  };
}

export function issueAuthCookie(
  response: Pick<AuthCookieResponse, 'cookie'>,
  cookie: AuthCookieDefinition,
  value: string,
): void {
  response.cookie(cookie.name, value, cookie.issue);
}

export function clearAuthCookie(
  response: Pick<AuthCookieResponse, 'clearCookie'>,
  cookie: AuthCookieDefinition,
): void {
  response.clearCookie(cookie.name, cookie.clear);
}

function definition(
  name: string,
  secure: boolean,
  httpOnly: boolean,
  sameSite: 'lax' | 'strict',
  maxAgeSeconds: number,
): AuthCookieDefinition {
  const common = Object.freeze({
    path: '/',
    secure,
    httpOnly,
    sameSite,
  } satisfies CookieOptions);
  return Object.freeze({
    name,
    issue: Object.freeze({ ...common, maxAge: maxAgeSeconds * 1000 }),
    clear: common,
  });
}
