import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export type IdempotencyState = 'pending' | 'completed';

@Unique('idempotency_records_scope_uq', [
  'scopeHash',
  'idempotencyKey',
  'method',
  'routeId',
])
@Index('idempotency_records_expiry_idx', ['expiresAt'])
@Check('idempotency_records_state_ck', "state IN ('pending', 'completed')")
@Check(
  'idempotency_records_hash_ck',
  "scope_hash ~ '^[0-9a-f]{64}$' AND payload_sha256 ~ '^[0-9a-f]{64}$'",
)
@Check(
  'idempotency_records_response_ck',
  "(state = 'pending' AND response_status IS NULL AND response_body IS NULL) OR (state = 'completed' AND response_status BETWEEN 100 AND 599)",
)
@Check(
  'idempotency_records_version_ck',
  'resource_version IS NULL OR resource_version >= 0',
)
@Entity({ name: 'idempotency_records' })
export class IdempotencyRecordEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'scope_hash', type: 'char', length: 64 })
  scopeHash!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  @Column({ name: 'route_id', type: 'varchar', length: 128 })
  routeId!: string;

  @Column({ name: 'payload_sha256', type: 'char', length: 64 })
  payloadSha256!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: IdempotencyState;

  @Column({ name: 'response_status', type: 'smallint', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: Readonly<Record<string, unknown>> | null;

  @Column({ name: 'resource_version', type: 'integer', nullable: true })
  resourceVersion!: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
