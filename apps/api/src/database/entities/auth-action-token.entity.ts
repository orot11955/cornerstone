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

export type AuthActionTokenPurpose = 'verify_email' | 'reset_password';

@Unique('auth_action_tokens_hash_uq', ['tokenHash'])
@Index('auth_action_tokens_active_uq', ['userId', 'purpose'], {
  unique: true,
  where: 'consumed_at IS NULL AND revoked_at IS NULL',
})
@Index('auth_action_tokens_expiry_idx', ['expiresAt'], {
  where: 'consumed_at IS NULL AND revoked_at IS NULL',
})
@Check(
  'auth_action_tokens_purpose_ck',
  "purpose IN ('verify_email', 'reset_password')",
)
@Check(
  'auth_action_tokens_attempt_ck',
  'attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts',
)
@Check('auth_action_tokens_hash_ck', "token_hash ~ '^[0-9a-f]{64}$'")
@Entity({ name: 'auth_action_tokens' })
export class AuthActionTokenEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'auth_action_tokens_user_fk',
  })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 32 })
  purpose!: AuthActionTokenPurpose;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'key_version', type: 'varchar', length: 64 })
  keyVersion!: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({
    name: 'consumed_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  consumedAt!: Date | null;

  @Column({
    name: 'revoked_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  revokedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
