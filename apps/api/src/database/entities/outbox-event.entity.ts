import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Index('outbox_events_available_idx', ['availableAt', 'createdAt'], {
  where: 'processed_at IS NULL',
})
@Check('outbox_events_version_ck', 'event_version > 0')
@Check(
  'outbox_events_attempt_ck',
  'attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts',
)
@Check(
  'outbox_events_lock_ck',
  '(locked_at IS NULL AND locked_by IS NULL) OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)',
)
@Entity({ name: 'outbox_events' })
export class OutboxEventEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType!: string;

  @Column({ name: 'event_version', type: 'integer' })
  eventVersion!: number;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'jsonb' })
  payload!: Readonly<Record<string, unknown>>;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 10 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', precision: 3 })
  availableAt!: Date;

  @Column({
    name: 'locked_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 100, nullable: true })
  lockedBy!: string | null;

  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true,
  })
  processedAt!: Date | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
