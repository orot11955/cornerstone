import type { UserEntity } from '../database/entities/user.entity.js';
import type { UserResponseDto } from './user.dto.js';

export function toUserResponse(user: UserEntity): UserResponseDto {
  return {
    id: user.id,
    email: user.emailNormalized,
    status: user.status,
    role: user.role,
    version: user.version,
    emailVerifiedAt: toNullableInstant(user.emailVerifiedAt),
    createdAt: toInstant(user.createdAt),
    updatedAt: toInstant(user.updatedAt),
  };
}

function toNullableInstant(value: Date | null): string | null {
  return value === null ? null : toInstant(value);
}

function toInstant(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error('Invalid User instant');
  return value.toISOString();
}
