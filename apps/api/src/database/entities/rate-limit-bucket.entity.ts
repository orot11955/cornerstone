import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Unique('rate_limit_buckets_window_uq', [
  'subjectHash',
  'policyId',
  'windowStart',
])
@Index('rate_limit_buckets_expiry_idx', ['expiresAt'])
@Check('rate_limit_buckets_subject_hash_ck', "subject_hash ~ '^[0-9a-f]{64}$'")
@Check('rate_limit_buckets_count_ck', 'count >= 0')
@Entity({ name: 'rate_limit_buckets' })
export class RateLimitBucketEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'subject_hash', type: 'char', length: 64 })
  subjectHash!: string;

  @Column({ name: 'policy_id', type: 'varchar', length: 64 })
  policyId!: string;

  @Column({ name: 'window_start', type: 'timestamptz', precision: 3 })
  windowStart!: Date;

  @Column({ type: 'integer', default: 0 })
  count!: number;

  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
