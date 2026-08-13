import type { Permission, Role } from '../identity/identity.contract.js';

export type HttpMethod = 'delete' | 'get' | 'patch' | 'post';
export type AuthenticationRequirement = 'anonymous' | 'refresh' | 'session';
export type OwnershipRequirement = 'none' | 'self' | 'target';

export interface RoutePolicy {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId: string;
  readonly authentication: AuthenticationRequirement;
  readonly csrf: boolean;
  readonly roles: readonly Role[];
  readonly permission?: Permission;
  readonly ownership: OwnershipRequirement;
  readonly owner: 'backend' | 'operations';
  readonly reason: string;
}

export const routePolicies = [
  publicPolicy(
    'get',
    '/api/v1/health/live',
    'getLiveness',
    'Load balancer liveness probe.',
  ),
  publicPolicy(
    'get',
    '/api/v1/health/ready',
    'getReadiness',
    'Load balancer readiness probe.',
  ),
  publicPolicy(
    'get',
    '/api/v1/auth/csrf',
    'getCsrfToken',
    'Signed pre-authentication CSRF bootstrap.',
  ),
  publicPolicy(
    'post',
    '/api/v1/auth/register',
    'register',
    'Account registration entrypoint.',
  ),
  publicPolicy(
    'post',
    '/api/v1/auth/verify-email',
    'verifyEmail',
    'Purpose-bound email verification token.',
  ),
  publicPolicy(
    'post',
    '/api/v1/auth/verification/resend',
    'resendVerification',
    'Enumeration-safe verification delivery.',
  ),
  publicPolicy(
    'post',
    '/api/v1/auth/login',
    'login',
    'Credential authentication entrypoint.',
  ),
  refreshPolicy(),
  publicPolicy(
    'post',
    '/api/v1/auth/password/forgot',
    'requestPasswordReset',
    'Enumeration-safe recovery delivery.',
  ),
  publicPolicy(
    'post',
    '/api/v1/auth/password/reset',
    'resetPassword',
    'Purpose-bound password reset token.',
  ),
  sessionPolicy(
    'get',
    '/api/v1/auth/me',
    'getCurrentUser',
    'profile:read',
    'self',
  ),
  sessionPolicy(
    'post',
    '/api/v1/auth/logout',
    'logout',
    'session:revoke',
    'self',
    true,
  ),
  sessionPolicy(
    'post',
    '/api/v1/auth/password/change',
    'changePassword',
    'profile:update',
    'self',
    true,
  ),
  sessionPolicy(
    'post',
    '/api/v1/auth/recent-auth',
    'confirmRecentAuthentication',
    'profile:update',
    'self',
    true,
  ),
  sessionPolicy(
    'get',
    '/api/v1/auth/sessions',
    'listSessions',
    'session:list',
    'self',
  ),
  sessionPolicy(
    'delete',
    '/api/v1/auth/sessions/{sessionId}',
    'revokeSession',
    'session:revoke',
    'self',
    true,
  ),
  sessionPolicy(
    'delete',
    '/api/v1/auth/sessions',
    'revokeAllSessions',
    'session:revoke',
    'self',
    true,
  ),
  sessionPolicy(
    'delete',
    '/api/v1/users/me',
    'deleteCurrentUser',
    'profile:update',
    'self',
    true,
  ),
  adminPolicy('get', '/api/v1/users', 'listUsers', 'user:list'),
  adminPolicy(
    'get',
    '/api/v1/users/{userId}',
    'getUser',
    'user:read',
    'target',
  ),
  adminPolicy(
    'patch',
    '/api/v1/users/{userId}/role',
    'updateUserRole',
    'user:update-role',
    'target',
    true,
  ),
  adminPolicy(
    'patch',
    '/api/v1/users/{userId}/status',
    'updateUserStatus',
    'user:update-status',
    'target',
    true,
  ),
] as const satisfies readonly RoutePolicy[];

validateRoutePolicies(routePolicies);

export function getRoutePolicy(
  method: string,
  path: string,
): RoutePolicy | undefined {
  const normalizedMethod = method.toLowerCase();
  return routePolicies.find(
    (policy) => policy.method === normalizedMethod && policy.path === path,
  );
}

export function validateRoutePolicies(policies: readonly RoutePolicy[]): void {
  const routes = new Set<string>();
  const operations = new Set<string>();
  for (const policy of policies) {
    const key = `${policy.method} ${policy.path}`;
    if (routes.has(key)) throw new Error(`Duplicate route policy: ${key}`);
    if (operations.has(policy.operationId)) {
      throw new Error(`Duplicate operation policy: ${policy.operationId}`);
    }
    if (!policy.reason.trim()) throw new Error(`Missing route reason: ${key}`);
    if (policy.authentication === 'anonymous' && policy.roles.length > 0) {
      throw new Error(`Anonymous route cannot require a role: ${key}`);
    }
    if (policy.csrf && policy.method === 'get') {
      throw new Error(`Safe route cannot require CSRF: ${key}`);
    }
    routes.add(key);
    operations.add(policy.operationId);
  }
}

function publicPolicy(
  method: HttpMethod,
  path: string,
  operationId: string,
  reason: string,
): RoutePolicy {
  return {
    method,
    path,
    operationId,
    authentication: 'anonymous',
    csrf: method !== 'get',
    roles: [],
    ownership: 'none',
    owner: 'backend',
    reason,
  };
}

function refreshPolicy(): RoutePolicy {
  return {
    method: 'post',
    path: '/api/v1/auth/refresh',
    operationId: 'refreshSession',
    authentication: 'refresh',
    csrf: true,
    roles: [],
    ownership: 'self',
    owner: 'backend',
    reason: 'Rotating refresh cookie authentication entrypoint.',
  };
}

function sessionPolicy(
  method: HttpMethod,
  path: string,
  operationId: string,
  permission: Permission,
  ownership: OwnershipRequirement,
  csrf = false,
): RoutePolicy {
  return {
    method,
    path,
    operationId,
    authentication: 'session',
    csrf,
    roles: ['user', 'admin'],
    permission,
    ownership,
    owner: 'backend',
    reason: `Authenticated ${permission} operation.`,
  };
}

function adminPolicy(
  method: HttpMethod,
  path: string,
  operationId: string,
  permission: Permission,
  ownership: OwnershipRequirement = 'none',
  csrf = false,
): RoutePolicy {
  return {
    method,
    path,
    operationId,
    authentication: 'session',
    csrf,
    roles: ['admin'],
    permission,
    ownership,
    owner: 'backend',
    reason: `Administrator ${permission} operation.`,
  };
}
