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
import { AuthSessionEntity } from './auth-session.entity.js';

@Unique('auth_refresh_tokens_hash_uq', ['tokenHash'])
@Unique('auth_refresh_tokens_generation_uq', ['sessionId', 'generation'])
@Index('auth_refresh_tokens_expiry_idx', ['expiresAt', 'revokedAt'])
@Check('auth_refresh_tokens_generation_ck', 'generation >= 0')
@Check('auth_refresh_tokens_hash_ck', "token_hash ~ '^[0-9a-f]{64}$'")
@Entity({ name: 'auth_refresh_tokens' })
export class AuthRefreshTokenEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => AuthSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'auth_refresh_tokens_session_fk',
  })
  session!: AuthSessionEntity;

  @Column({ type: 'integer' })
  generation!: number;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'key_version', type: 'varchar', length: 64 })
  keyVersion!: string;

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
