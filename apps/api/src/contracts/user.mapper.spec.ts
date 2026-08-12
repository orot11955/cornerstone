import type { UserEntity } from '../database/entities/user.entity.js';
import { toUserResponse } from './user.mapper.js';

describe('toUserResponse', () => {
  it('serializes UTC instants and exposes no persistence-only fields', () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      emailNormalized: 'user@example.com',
      passwordHash: 'must-not-leak',
      status: 'active',
      role: 'user',
      authzVersion: 7,
      version: 3,
      emailVerifiedAt: new Date('2026-08-13T01:02:03.456Z'),
      suspendedAt: null,
      deletedAt: null,
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    } satisfies UserEntity;

    const response = toUserResponse(user);
    expect(response).toEqual({
      id: user.id,
      email: 'user@example.com',
      status: 'active',
      role: 'user',
      version: 3,
      emailVerifiedAt: '2026-08-13T01:02:03.456Z',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(JSON.stringify(response)).not.toContain('must-not-leak');
    expect(response).not.toHaveProperty('authzVersion');
  });
});
