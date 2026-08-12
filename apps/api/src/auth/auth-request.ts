import type { Request } from 'express';
import type { AuthenticatedPrincipal } from './auth-lifecycle.service.js';

const principalKey = Symbol('cornerstone.auth.principal');

export type AuthenticatedRequest = Request & {
  [principalKey]?: AuthenticatedPrincipal;
};

export function setAuthenticatedPrincipal(
  request: AuthenticatedRequest,
  principal: AuthenticatedPrincipal,
): void {
  request[principalKey] = principal;
}

export function getAuthenticatedPrincipal(
  request: AuthenticatedRequest,
): AuthenticatedPrincipal {
  const principal = request[principalKey];
  if (!principal) throw new Error('Authenticated principal is unavailable');
  return principal;
}
