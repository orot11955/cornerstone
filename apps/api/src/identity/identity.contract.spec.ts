import {
  assertUserStatusTransition,
  authorizationImpact,
  canTransitionUserStatus,
  deletedEmail,
  hasPermission,
  normalizeEmail,
  type UserStatus,
} from './identity.contract.js';

describe('identity data contract', () => {
  it('normalizes equivalent email input before unique comparison', () => {
    expect(normalizeEmail('  ＴＥＳＴ@Example.COM ')).toBe('test@example.com');
  });

  it('allows only the approved User state graph and keeps deleted terminal', () => {
    const allowed: readonly [UserStatus, UserStatus][] = [
      ['pending_verification', 'active'],
      ['pending_verification', 'deleted'],
      ['active', 'suspended'],
      ['active', 'deleted'],
      ['suspended', 'active'],
      ['suspended', 'deleted'],
    ];
    for (const [from, to] of allowed)
      expect(canTransitionUserStatus(from, to)).toBe(true);
    expect(canTransitionUserStatus('deleted', 'active')).toBe(false);
    expect(() =>
      assertUserStatusTransition('active', 'pending_verification'),
    ).toThrow();
  });

  it('maps Roles to a closed permission registry', () => {
    expect(hasPermission('user', 'profile:update')).toBe(true);
    expect(hasPermission('user', 'user:update-role')).toBe(false);
    expect(hasPermission('admin', 'user:update-role')).toBe(true);
  });

  it('defines deterministic revoke effects for every security event', () => {
    expect(authorizationImpact('logout')).toEqual({
      incrementAuthzVersion: false,
      revoke: 'current-session',
    });
    expect(authorizationImpact('role_change')).toEqual({
      incrementAuthzVersion: true,
      revoke: 'all-sessions',
    });
  });

  it('creates a reserved non-deliverable email for deleted Users', () => {
    expect(deletedEmail('550e8400-e29b-41d4-a716-446655440000')).toBe(
      'deleted+550e8400-e29b-41d4-a716-446655440000@users.invalid',
    );
    expect(() => deletedEmail('not-a-user-id')).toThrow();
  });
});
