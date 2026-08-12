import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdentityCore1786579260000 implements MigrationInterface {
  name = 'CreateIdentityCore1786579260000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email_normalized varchar(254) NOT NULL,
        password_hash varchar(255),
        status varchar(32) NOT NULL,
        role varchar(32) NOT NULL,
        authz_version integer NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 0,
        email_verified_at timestamptz(3),
        suspended_at timestamptz(3),
        deleted_at timestamptz(3),
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL,
        CONSTRAINT users_email_normalized_uq UNIQUE (email_normalized),
        CONSTRAINT users_status_ck CHECK (status IN ('pending_verification', 'active', 'suspended', 'deleted')),
        CONSTRAINT users_role_ck CHECK (role IN ('user', 'admin')),
        CONSTRAINT users_authz_version_ck CHECK (authz_version >= 0),
        CONSTRAINT users_version_ck CHECK (version >= 0),
        CONSTRAINT users_suspension_ck CHECK (
          (status = 'suspended' AND suspended_at IS NOT NULL)
          OR (status <> 'suspended' AND suspended_at IS NULL)
        ),
        CONSTRAINT users_deletion_ck CHECK (
          (status = 'deleted' AND deleted_at IS NOT NULL AND password_hash IS NULL)
          OR (status <> 'deleted' AND deleted_at IS NULL)
        )
      )
    `);
    await queryRunner.query(
      'CREATE INDEX users_status_created_at_idx ON users (status, created_at)',
    );

    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY,
        family_id uuid NOT NULL,
        user_id uuid NOT NULL,
        current_generation integer NOT NULL DEFAULT 0,
        device_label varchar(120),
        last_password_auth_at timestamptz(3) NOT NULL,
        last_seen_at timestamptz(3) NOT NULL,
        idle_expires_at timestamptz(3) NOT NULL,
        absolute_expires_at timestamptz(3) NOT NULL,
        revoked_at timestamptz(3),
        revoke_reason varchar(64),
        version integer NOT NULL DEFAULT 0,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL,
        CONSTRAINT auth_sessions_family_uq UNIQUE (family_id),
        CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT auth_sessions_generation_ck CHECK (current_generation >= 0),
        CONSTRAINT auth_sessions_version_ck CHECK (version >= 0),
        CONSTRAINT auth_sessions_expiry_ck CHECK (idle_expires_at <= absolute_expires_at),
        CONSTRAINT auth_sessions_revocation_ck CHECK (
          (revoked_at IS NULL AND revoke_reason IS NULL)
          OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX auth_sessions_user_active_idx
      ON auth_sessions (user_id, revoked_at, absolute_expires_at)
    `);

    await queryRunner.query(`
      CREATE TABLE auth_refresh_tokens (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL,
        generation integer NOT NULL,
        token_hash char(64) NOT NULL,
        key_version varchar(64) NOT NULL,
        expires_at timestamptz(3) NOT NULL,
        consumed_at timestamptz(3),
        revoked_at timestamptz(3),
        created_at timestamptz(3) NOT NULL,
        CONSTRAINT auth_refresh_tokens_session_fk FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
        CONSTRAINT auth_refresh_tokens_hash_uq UNIQUE (token_hash),
        CONSTRAINT auth_refresh_tokens_generation_uq UNIQUE (session_id, generation),
        CONSTRAINT auth_refresh_tokens_generation_ck CHECK (generation >= 0),
        CONSTRAINT auth_refresh_tokens_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX auth_refresh_tokens_expiry_idx
      ON auth_refresh_tokens (expires_at, revoked_at)
    `);

    await queryRunner.query(`
      CREATE TABLE auth_action_tokens (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        purpose varchar(32) NOT NULL,
        token_hash char(64) NOT NULL,
        key_version varchar(64) NOT NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL,
        expires_at timestamptz(3) NOT NULL,
        consumed_at timestamptz(3),
        revoked_at timestamptz(3),
        created_at timestamptz(3) NOT NULL,
        CONSTRAINT auth_action_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT auth_action_tokens_hash_uq UNIQUE (token_hash),
        CONSTRAINT auth_action_tokens_purpose_ck CHECK (purpose IN ('verify_email', 'reset_password')),
        CONSTRAINT auth_action_tokens_attempt_ck CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
        CONSTRAINT auth_action_tokens_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX auth_action_tokens_active_uq
      ON auth_action_tokens (user_id, purpose)
      WHERE consumed_at IS NULL AND revoked_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX auth_action_tokens_expiry_idx
      ON auth_action_tokens (expires_at)
      WHERE consumed_at IS NULL AND revoked_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE idempotency_records (
        id uuid PRIMARY KEY,
        scope_hash char(64) NOT NULL,
        idempotency_key varchar(128) NOT NULL,
        method varchar(10) NOT NULL,
        route_id varchar(128) NOT NULL,
        payload_sha256 char(64) NOT NULL,
        state varchar(16) NOT NULL,
        response_status smallint,
        response_body jsonb,
        resource_version integer,
        expires_at timestamptz(3) NOT NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL,
        CONSTRAINT idempotency_records_scope_uq UNIQUE (scope_hash, idempotency_key, method, route_id),
        CONSTRAINT idempotency_records_state_ck CHECK (state IN ('pending', 'completed')),
        CONSTRAINT idempotency_records_hash_ck CHECK (
          scope_hash ~ '^[0-9a-f]{64}$' AND payload_sha256 ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT idempotency_records_response_ck CHECK (
          (state = 'pending' AND response_status IS NULL AND response_body IS NULL)
          OR (state = 'completed' AND response_status BETWEEN 100 AND 599)
        ),
        CONSTRAINT idempotency_records_version_ck CHECK (resource_version IS NULL OR resource_version >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at)',
    );

    await queryRunner.query(`
      CREATE TABLE rate_limit_buckets (
        id uuid PRIMARY KEY,
        subject_hash char(64) NOT NULL,
        policy_id varchar(64) NOT NULL,
        window_start timestamptz(3) NOT NULL,
        count integer NOT NULL DEFAULT 0,
        expires_at timestamptz(3) NOT NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL,
        CONSTRAINT rate_limit_buckets_window_uq UNIQUE (subject_hash, policy_id, window_start),
        CONSTRAINT rate_limit_buckets_subject_hash_ck CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT rate_limit_buckets_count_ck CHECK (count >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at)',
    );

    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY,
        event_type varchar(128) NOT NULL,
        event_version integer NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 10,
        available_at timestamptz(3) NOT NULL,
        locked_at timestamptz(3),
        locked_by varchar(100),
        processed_at timestamptz(3),
        last_error_code varchar(64),
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL,
        CONSTRAINT outbox_events_version_ck CHECK (event_version > 0),
        CONSTRAINT outbox_events_attempt_ck CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
        CONSTRAINT outbox_events_lock_ck CHECK (
          (locked_at IS NULL AND locked_by IS NULL)
          OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX outbox_events_available_idx
      ON outbox_events (available_at, created_at)
      WHERE processed_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY,
        event_type varchar(128) NOT NULL,
        event_version integer NOT NULL,
        actor_id varchar(128),
        subject_id varchar(128),
        resource_id varchar(128),
        outcome varchar(32) NOT NULL,
        reason_code varchar(64),
        request_id varchar(128),
        trace_id char(32),
        metadata jsonb NOT NULL,
        occurred_at timestamptz(3) NOT NULL,
        recorded_at timestamptz(3) NOT NULL,
        CONSTRAINT audit_events_version_ck CHECK (event_version > 0),
        CONSTRAINT audit_events_outcome_ck CHECK (outcome IN ('success', 'denied', 'failure')),
        CONSTRAINT audit_events_trace_ck CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$')
      )
    `);
    await queryRunner.query(
      'CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at, id)',
    );
    await queryRunner.query(
      'CREATE INDEX audit_events_subject_idx ON audit_events (subject_id, occurred_at)',
    );

    await queryRunner.query(`
      CREATE FUNCTION cornerstone_cleanup_retention(
        requested_batch_size integer,
        requested_now timestamptz
      ) RETURNS TABLE(category text, deleted_count integer)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF requested_batch_size IS NULL
          OR requested_batch_size < 1
          OR requested_batch_size > 1000 THEN
          RAISE EXCEPTION 'retention batch size must be 1..1000';
        END IF;
        IF requested_now IS NULL THEN
          RAISE EXCEPTION 'retention time is required';
        END IF;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM auth_sessions
          WHERE COALESCE(revoked_at, LEAST(idle_expires_at, absolute_expires_at))
            < requested_now - interval '90 days'
          ORDER BY COALESCE(revoked_at, LEAST(idle_expires_at, absolute_expires_at)), id
          FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM auth_sessions AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'sessions'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM auth_action_tokens
          WHERE (consumed_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < requested_now)
            AND LEAST(
              COALESCE(consumed_at, 'infinity'),
              COALESCE(revoked_at, 'infinity'),
              expires_at
            ) < requested_now - interval '30 days'
          ORDER BY LEAST(
            COALESCE(consumed_at, 'infinity'),
            COALESCE(revoked_at, 'infinity'),
            expires_at
          ), id
          FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM auth_action_tokens AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'actionTokens'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM idempotency_records
          WHERE expires_at < requested_now
          ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM idempotency_records AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'idempotency'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM rate_limit_buckets
          WHERE expires_at < requested_now
          ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM rate_limit_buckets AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'rateLimits'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM outbox_events
          WHERE processed_at < requested_now - interval '30 days'
            AND last_error_code IS NULL
          ORDER BY processed_at, id FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM outbox_events AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'outboxProcessed'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM outbox_events
          WHERE processed_at < requested_now - interval '90 days'
            AND last_error_code IS NOT NULL AND attempts >= max_attempts
          ORDER BY processed_at, id FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM outbox_events AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'outboxPoison'::text, count(*)::integer FROM deleted;

        RETURN QUERY
        WITH candidates AS (
          SELECT id FROM audit_events
          WHERE occurred_at < requested_now - interval '365 days'
          ORDER BY occurred_at, id FOR UPDATE SKIP LOCKED LIMIT requested_batch_size
        ), deleted AS (
          DELETE FROM audit_events AS target USING candidates
          WHERE target.id = candidates.id RETURNING 1
        ) SELECT 'audit'::text, count(*)::integer FROM deleted;
      END
      $$
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION cornerstone_cleanup_retention(integer, timestamptz)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION cornerstone_cleanup_retention(integer, timestamptz)
      TO cornerstone_maintenance
    `);

    await queryRunner.query(
      'GRANT SELECT, INSERT, UPDATE ON users TO cornerstone_runtime',
    );
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON auth_sessions, auth_refresh_tokens, auth_action_tokens,
         idempotency_records, rate_limit_buckets, outbox_events
      TO cornerstone_runtime
    `);
    await queryRunner.query(
      'GRANT SELECT, INSERT ON audit_events TO cornerstone_runtime',
    );
    await queryRunner.query(
      'GRANT SELECT ON cornerstone_migrations TO cornerstone_runtime',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP FUNCTION cornerstone_cleanup_retention(integer, timestamptz)',
    );
    await queryRunner.query('DROP TABLE audit_events');
    await queryRunner.query('DROP TABLE outbox_events');
    await queryRunner.query('DROP TABLE rate_limit_buckets');
    await queryRunner.query('DROP TABLE idempotency_records');
    await queryRunner.query('DROP TABLE auth_action_tokens');
    await queryRunner.query('DROP TABLE auth_refresh_tokens');
    await queryRunner.query('DROP TABLE auth_sessions');
    await queryRunner.query('DROP TABLE users');
  }
}
