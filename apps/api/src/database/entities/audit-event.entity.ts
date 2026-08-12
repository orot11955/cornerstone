import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type AuditOutcome = 'success' | 'denied' | 'failure';

@Index('audit_events_occurred_at_idx', ['occurredAt', 'id'])
@Index('audit_events_subject_idx', ['subjectId', 'occurredAt'])
@Check('audit_events_version_ck', 'event_version > 0')
@Check('audit_events_outcome_ck', "outcome IN ('success', 'denied', 'failure')")
@Check(
  'audit_events_trace_ck',
  "trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'",
)
@Entity({ name: 'audit_events' })
export class AuditEventEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType!: string;

  @Column({ name: 'event_version', type: 'integer' })
  eventVersion!: number;

  @Column({ name: 'actor_id', type: 'varchar', length: 128, nullable: true })
  actorId!: string | null;

  @Column({ name: 'subject_id', type: 'varchar', length: 128, nullable: true })
  subjectId!: string | null;

  @Column({ name: 'resource_id', type: 'varchar', length: 128, nullable: true })
  resourceId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  outcome!: AuditOutcome;

  @Column({ name: 'reason_code', type: 'varchar', length: 64, nullable: true })
  reasonCode!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  requestId!: string | null;

  @Column({ name: 'trace_id', type: 'char', length: 32, nullable: true })
  traceId!: string | null;

  @Column({ type: 'jsonb' })
  metadata!: Readonly<Record<string, unknown>>;

  @Column({ name: 'occurred_at', type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  @Column({ name: 'recorded_at', type: 'timestamptz', precision: 3 })
  recordedAt!: Date;
}
