import { emailSchema } from '@cornerstone/schemas';

export const userStatuses = [
  'pending_verification',
  'active',
  'suspended',
  'deleted',
] as const;
export type UserStatus = (typeof userStatuses)[number];

export const roles = ['user', 'admin'] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  'profile:read',
  'profile:update',
  'session:list',
  'session:revoke',
  'user:list',
  'user:read',
  'user:update-role',
  'user:update-status',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  user: new Set([
    'profile:read',
    'profile:update',
    'session:list',
    'session:revoke',
  ]),
  admin: new Set(permissions),
};

const stateTransitions: Readonly<Record<UserStatus, ReadonlySet<UserStatus>>> =
  {
    pending_verification: new Set(['active', 'deleted']),
    active: new Set(['suspended', 'deleted']),
    suspended: new Set(['active', 'deleted']),
    deleted: new Set(),
  };

export const securityEvents = [
  'login',
  'logout',
  'session_revoke',
  'password_change',
  'password_reset',
  'role_change',
  'status_change',
  'ownership_change',
  'user_delete',
] as const;
export type SecurityEvent = (typeof securityEvents)[number];

export interface AuthorizationImpact {
  readonly incrementAuthzVersion: boolean;
  readonly revoke:
    'none' | 'current-session' | 'target-session' | 'all-sessions';
}

const authorizationImpacts: Readonly<
  Record<SecurityEvent, AuthorizationImpact>
> = {
  login: { incrementAuthzVersion: false, revoke: 'none' },
  logout: { incrementAuthzVersion: false, revoke: 'current-session' },
  session_revoke: { incrementAuthzVersion: false, revoke: 'target-session' },
  password_change: { incrementAuthzVersion: true, revoke: 'all-sessions' },
  password_reset: { incrementAuthzVersion: true, revoke: 'all-sessions' },
  role_change: { incrementAuthzVersion: true, revoke: 'all-sessions' },
  status_change: { incrementAuthzVersion: true, revoke: 'all-sessions' },
  ownership_change: { incrementAuthzVersion: true, revoke: 'all-sessions' },
  user_delete: { incrementAuthzVersion: true, revoke: 'all-sessions' },
};

export function normalizeEmail(value: string): string {
  return emailSchema.parse(value);
}

export function canTransitionUserStatus(
  from: UserStatus,
  to: UserStatus,
): boolean {
  return stateTransitions[from].has(to);
}

export function assertUserStatusTransition(
  from: UserStatus,
  to: UserStatus,
): void {
  if (!canTransitionUserStatus(from, to)) {
    throw new TypeError(
      `User status transition ${from} -> ${to} is not allowed`,
    );
  }
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function authorizationImpact(event: SecurityEvent): AuthorizationImpact {
  return authorizationImpacts[event];
}

export function deletedEmail(userId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new TypeError('Deleted User ID must be a UUID v4');
  }
  return `deleted+${userId.toLowerCase()}@users.invalid`;
}
