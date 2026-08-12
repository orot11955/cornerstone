import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type { Role, UserStatus } from '../../identity/identity.contract.js';

@Unique('users_email_normalized_uq', ['emailNormalized'])
@Index('users_status_created_at_idx', ['status', 'createdAt'])
@Check(
  'users_status_ck',
  "status IN ('pending_verification', 'active', 'suspended', 'deleted')",
)
@Check('users_role_ck', "role IN ('user', 'admin')")
@Check('users_authz_version_ck', 'authz_version >= 0')
@Check('users_version_ck', 'version >= 0')
@Check(
  'users_suspension_ck',
  "(status = 'suspended' AND suspended_at IS NOT NULL) OR (status <> 'suspended' AND suspended_at IS NULL)",
)
@Check(
  'users_deletion_ck',
  "(status = 'deleted' AND deleted_at IS NOT NULL AND password_hash IS NULL) OR (status <> 'deleted' AND deleted_at IS NULL)",
)
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'email_normalized', type: 'varchar', length: 254 })
  emailNormalized!: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: UserStatus;

  @Column({ type: 'varchar', length: 32 })
  role!: Role;

  @Column({ name: 'authz_version', type: 'integer', default: 0 })
  authzVersion!: number;

  @Column({ type: 'integer', default: 0 })
  version!: number;

  @Column({
    name: 'email_verified_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  emailVerifiedAt!: Date | null;

  @Column({
    name: 'suspended_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  suspendedAt!: Date | null;

  @Column({
    name: 'deleted_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  deletedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
