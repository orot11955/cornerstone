import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity.js';

@Unique('auth_sessions_family_uq', ['familyId'])
@Index('auth_sessions_user_active_idx', [
  'userId',
  'revokedAt',
  'absoluteExpiresAt',
])
@Check('auth_sessions_generation_ck', 'current_generation >= 0')
@Check('auth_sessions_version_ck', 'version >= 0')
@Check('auth_sessions_expiry_ck', 'idle_expires_at <= absolute_expires_at')
@Check(
  'auth_sessions_revocation_ck',
  '(revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)',
)
@Entity({ name: 'auth_sessions' })
export class AuthSessionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'auth_sessions_user_fk',
  })
  user!: UserEntity;

  @Column({ name: 'current_generation', type: 'integer', default: 0 })
  currentGeneration!: number;

  @Column({
    name: 'device_label',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  deviceLabel!: string | null;

  @Column({ name: 'last_password_auth_at', type: 'timestamptz', precision: 3 })
  lastPasswordAuthAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', precision: 3 })
  lastSeenAt!: Date;

  @Column({ name: 'idle_expires_at', type: 'timestamptz', precision: 3 })
  idleExpiresAt!: Date;

  @Column({ name: 'absolute_expires_at', type: 'timestamptz', precision: 3 })
  absoluteExpiresAt!: Date;

  @Column({
    name: 'revoked_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  revokedAt!: Date | null;

  @Column({
    name: 'revoke_reason',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  revokeReason!: string | null;

  @Column({ type: 'integer', default: 0 })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
