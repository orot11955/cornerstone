import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantAdminBootstrap1786579300000 implements MigrationInterface {
  name = 'GrantAdminBootstrap1786579300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE admin_bootstrap_markers (
      singleton boolean PRIMARY KEY DEFAULT TRUE,
      user_id uuid NOT NULL,
      created_at timestamptz(3) NOT NULL,
      CONSTRAINT admin_bootstrap_markers_singleton_ck CHECK (singleton),
      CONSTRAINT admin_bootstrap_markers_user_uq UNIQUE (user_id),
      CONSTRAINT admin_bootstrap_markers_user_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE FUNCTION public.cornerstone_bootstrap_initial_admin(
      requested_user_id uuid, requested_audit_id uuid, requested_email text,
      requested_password_hash text, requested_request_id text
    ) RETURNS TABLE(user_id uuid, audit_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    BEGIN
      IF requested_email IS NULL
        OR pg_catalog.length(requested_email) < 3
        OR pg_catalog.length(requested_email) > 254
        OR requested_email <> pg_catalog.lower(pg_catalog.btrim(requested_email))
        OR requested_email !~ '^[^@.[:space:][:cntrl:]][^@[:space:][:cntrl:]]*[^@.[:space:][:cntrl:]]@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?[.])+[A-Za-z]{2,63}$'
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB03', MESSAGE = 'invalid bootstrap email'; END IF;
      IF requested_password_hash IS NULL
        OR pg_catalog.length(requested_password_hash) > 255
        OR requested_password_hash !~ '^[$]argon2id[$]v=19[$]m=[0-9]{4,6},p=[1-4],t=[2-5][$][A-Za-z0-9+/]{22,86}[$][A-Za-z0-9+/]{22,86}$'
        OR pg_catalog.split_part(pg_catalog.split_part(requested_password_hash, 'm=', 2), ',', 1)::bigint NOT BETWEEN 19456 AND 262144
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB04', MESSAGE = 'invalid bootstrap password hash'; END IF;
      IF requested_user_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR requested_audit_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR requested_user_id = requested_audit_id
        OR requested_request_id IS NULL
        OR requested_request_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB05', MESSAGE = 'invalid bootstrap identifier'; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cornerstone:active-admin'));
      IF EXISTS (SELECT 1 FROM public.admin_bootstrap_markers)
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB01', MESSAGE = 'admin bootstrap already completed'; END IF;
      IF EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND status = 'active')
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB02', MESSAGE = 'active admin already exists'; END IF;
      INSERT INTO public.users (id, email_normalized, password_hash, status, role, authz_version, version, email_verified_at, suspended_at, deleted_at, created_at, updated_at)
      VALUES (requested_user_id, requested_email, requested_password_hash, 'active', 'admin', 0, 0, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO public.audit_events (id, event_type, event_version, actor_id, subject_id, resource_id, outcome, reason_code, request_id, trace_id, metadata, occurred_at, recorded_at)
      VALUES (requested_audit_id, 'identity.admin.bootstrap', 1, 'system:admin-bootstrap', requested_user_id, requested_user_id, 'success', 'INITIAL_ADMIN_CREATED', requested_request_id, NULL, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO public.admin_bootstrap_markers (singleton, user_id, created_at) VALUES (TRUE, requested_user_id, CURRENT_TIMESTAMP);
      RETURN QUERY SELECT requested_user_id, requested_audit_id;
    EXCEPTION WHEN unique_violation
      THEN RAISE EXCEPTION USING ERRCODE = 'CSB06', MESSAGE = 'bootstrap identity conflict';
    END $$`);
    await queryRunner.query(
      'REVOKE ALL ON TABLE public.admin_bootstrap_markers FROM PUBLIC, cornerstone_admin_bootstrap, cornerstone_runtime, cornerstone_maintenance',
    );
    await queryRunner.query(
      'REVOKE ALL ON FUNCTION public.cornerstone_bootstrap_initial_admin(uuid, uuid, text, text, text) FROM PUBLIC, cornerstone_runtime, cornerstone_maintenance',
    );
    await queryRunner.query(
      'GRANT EXECUTE ON FUNCTION public.cornerstone_bootstrap_initial_admin(uuid, uuid, text, text, text) TO cornerstone_admin_bootstrap',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'REVOKE EXECUTE ON FUNCTION public.cornerstone_bootstrap_initial_admin(uuid, uuid, text, text, text) FROM cornerstone_admin_bootstrap',
    );
    await queryRunner.query(
      'DROP FUNCTION public.cornerstone_bootstrap_initial_admin(uuid, uuid, text, text, text)',
    );
    await queryRunner.query('DROP TABLE admin_bootstrap_markers');
  }
}
