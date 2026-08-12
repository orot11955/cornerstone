import type { EntityManager } from 'typeorm';

export const developmentSeedUserId =
  '00000000-0000-4000-8000-000000000001' as const;
const developmentSeedAuditId = '00000000-0000-4000-8000-000000000002' as const;

export async function seedDevelopmentReference(
  manager: EntityManager,
): Promise<void> {
  const now = new Date();

  await manager.query(
    `INSERT INTO users (
       id, email_normalized, password_hash, status, role,
       authz_version, version, email_verified_at, suspended_at, deleted_at,
       created_at, updated_at
     ) VALUES ($1, 'developer@example.invalid', NULL, 'pending_verification', 'user',
       0, 0, NULL, NULL, NULL, $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [developmentSeedUserId, now],
  );

  await manager.query(
    `INSERT INTO audit_events (
       id, event_type, event_version, actor_id, subject_id, resource_id,
       outcome, reason_code, request_id, trace_id, metadata,
       occurred_at, recorded_at
     ) VALUES ($1, 'identity.user.seeded', 1, NULL, $2, $2,
       'success', 'development_seed', NULL, NULL, '{}'::jsonb, $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [developmentSeedAuditId, developmentSeedUserId, now],
  );
}
