import 'dotenv/config';
import { DataSource, type DataSourceOptions, type QueryRunner } from 'typeorm';
import {
  validateDatabaseEnvironment,
  type DatabaseEnvironmentVariables,
} from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';
import {
  acquireMigrationLock,
  releaseMigrationLock,
} from './migration-lock.js';

interface ScalarRow {
  readonly value: boolean | number | string;
}

interface BootstrapRoleRow {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly rolinherit: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcanlogin: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
}

interface RoleMembershipRow {
  readonly rolname: string;
}

interface FunctionGrantRow extends RoleMembershipRow {
  readonly isGrantable: boolean;
}

interface LoginMembershipRow extends RoleMembershipRow {
  readonly adminOption: boolean;
  readonly inheritOption: boolean;
  readonly setOption: boolean;
}

interface BootstrapFunctionRow {
  readonly owner: string;
  readonly prosecdef: boolean;
  readonly proconfig: readonly string[] | null;
}

const expectedTables = [
  'admin_bootstrap_markers',
  'audit_events',
  'auth_action_tokens',
  'auth_refresh_tokens',
  'auth_sessions',
  'idempotency_records',
  'outbox_events',
  'rate_limit_buckets',
  'users',
] as const;

async function scalar(
  source: DataSource,
  query: string,
  parameters: readonly unknown[] = [],
): Promise<ScalarRow['value']> {
  const rows: ScalarRow[] = await source.query(query, [...parameters]);
  const value = rows[0]?.value;
  if (value === undefined)
    throw new Error('Database verification returned no row');
  return value;
}

async function verify(): Promise<void> {
  const runtimeEnvironment = { ...process.env };
  delete runtimeEnvironment.DATABASE_ADMIN_BOOTSTRAP_URL;
  delete runtimeEnvironment.ADMIN_BOOTSTRAP_EMAIL;
  delete runtimeEnvironment.ADMIN_BOOTSTRAP_PASSWORD_FILE;
  delete runtimeEnvironment.ADMIN_BOOTSTRAP_REQUEST_ID;
  const environment = validateDatabaseEnvironment(runtimeEnvironment);
  const bootstrapUrl = process.env.DATABASE_ADMIN_BOOTSTRAP_URL;
  if (!bootstrapUrl) {
    throw new Error(
      'DATABASE_ADMIN_BOOTSTRAP_URL is required for the full database contract verification',
    );
  }
  const migrationDataSource = new DataSource(
    buildDatabaseOptions(environment, 'migration'),
  );
  const runtimeDataSource = new DataSource(
    buildDatabaseOptions(environment, 'runtime'),
  );
  const maintenanceDataSource = environment.DATABASE_MAINTENANCE_URL
    ? new DataSource(buildDatabaseOptions(environment, 'maintenance'))
    : undefined;
  const bootstrapDataSource = new DataSource(
    buildBootstrapVerificationOptions(bootstrapUrl, environment),
  );

  await migrationDataSource.initialize();
  try {
    const version = Number(
      await scalar(
        migrationDataSource,
        "SELECT current_setting('server_version_num')::integer AS value",
      ),
    );
    if (version < 170_000 || version >= 180_000) {
      throw new Error('PostgreSQL 17.x is required');
    }

    if (await migrationDataSource.showMigrations()) {
      throw new Error('Pending migrations exist');
    }

    const tables = await scalar(
      migrationDataSource,
      `SELECT array_agg(table_name ORDER BY table_name)::text AS value
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name <> 'cornerstone_migrations'`,
    );
    if (tables !== `{${expectedTables.join(',')}}`) {
      throw new Error('Public table set does not match the Identity contract');
    }

    const forbiddenColumns = Number(
      await scalar(
        migrationDataSource,
        `SELECT count(*)::integer AS value
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_name = 'tenant_id' OR table_name ILIKE '%membership%')`,
      ),
    );
    if (forbiddenColumns !== 0) {
      throw new Error(
        'Single-tenant Core contains tenant or membership schema',
      );
    }

    const schemaDiff = await migrationDataSource.driver
      .createSchemaBuilder()
      .log();
    if (schemaDiff.upQueries.length !== 0) {
      throw new Error(
        `Entity/Migration schema drift detected (${schemaDiff.upQueries.length} queries)`,
      );
    }

    const lockContender = new DataSource(
      buildDatabaseOptions(environment, 'migration'),
    );
    await lockContender.initialize();
    const lockHolderRunner = migrationDataSource.createQueryRunner();
    const lockContenderRunner = lockContender.createQueryRunner();
    await lockHolderRunner.connect();
    await lockContenderRunner.connect();
    try {
      await acquireMigrationLock(lockHolderRunner, 0);
      await expectLockContention(lockContenderRunner);
    } finally {
      await releaseMigrationLock(lockHolderRunner);
      await lockHolderRunner.release();
      await lockContenderRunner.release();
      await lockContender.destroy();
    }

    await runtimeDataSource.initialize();
    try {
      const runtimePrincipal = new URL(environment.DATABASE_URL).username;
      const forbiddenPrivileges = [
        ["has_schema_privilege($1, 'public', 'CREATE')", 'schema CREATE'],
        ["has_table_privilege($1, 'users', 'DELETE')", 'users DELETE'],
        [
          "has_table_privilege($1, 'admin_bootstrap_markers', 'SELECT')",
          'bootstrap marker SELECT',
        ],
        [
          "has_table_privilege($1, 'admin_bootstrap_markers', 'INSERT')",
          'bootstrap marker INSERT',
        ],
        [
          "has_table_privilege($1, 'admin_bootstrap_markers', 'UPDATE')",
          'bootstrap marker UPDATE',
        ],
        [
          "has_table_privilege($1, 'admin_bootstrap_markers', 'DELETE')",
          'bootstrap marker DELETE',
        ],
        ["has_table_privilege($1, 'audit_events', 'UPDATE')", 'audit UPDATE'],
        ["has_table_privilege($1, 'audit_events', 'DELETE')", 'audit DELETE'],
        ["has_table_privilege($1, 'audit_events', 'SELECT')", 'audit SELECT'],
        [
          `has_function_privilege(
             $1,
             'cornerstone_cleanup_retention(integer,timestamp with time zone)',
             'EXECUTE'
           )`,
          'retention function EXECUTE',
        ],
        [
          "has_table_privilege($1, 'cornerstone_migrations', 'UPDATE')",
          'migration UPDATE',
        ],
        [
          "has_function_privilege($1, 'public.cornerstone_bootstrap_initial_admin(uuid,uuid,text,text,text)', 'EXECUTE')",
          'bootstrap function EXECUTE',
        ],
      ] as const;

      for (const [expression, label] of forbiddenPrivileges) {
        if (
          await scalar(migrationDataSource, `SELECT ${expression} AS value`, [
            runtimePrincipal,
          ])
        ) {
          throw new Error(`Runtime principal unexpectedly has ${label}`);
        }
      }

      if (
        !(await scalar(
          runtimeDataSource,
          "SELECT has_table_privilege(current_user, 'users', 'SELECT,INSERT,UPDATE') AS value",
        ))
      ) {
        throw new Error(
          'Runtime principal is missing required users DML privileges',
        );
      }
      if (
        !(await scalar(
          runtimeDataSource,
          "SELECT has_table_privilege(current_user, 'cornerstone_migrations', 'SELECT') AS value",
        ))
      ) {
        throw new Error(
          'Runtime principal cannot inspect migration compatibility',
        );
      }
    } finally {
      await runtimeDataSource.destroy();
    }

    if (maintenanceDataSource) {
      await maintenanceDataSource.initialize();
      try {
        const allowed = await scalar(
          maintenanceDataSource,
          `SELECT has_function_privilege(
             current_user,
             'cornerstone_cleanup_retention(integer,timestamp with time zone)',
             'EXECUTE'
           ) AS value`,
        );
        if (!allowed) {
          throw new Error(
            'Maintenance principal cannot execute bounded retention cleanup',
          );
        }
        const forbidden = [
          ["has_schema_privilege(current_user, 'public', 'CREATE')", 'DDL'],
          [
            "has_table_privilege(current_user, 'users', 'DELETE')",
            'user DELETE',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'SELECT')",
            'audit SELECT',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'DELETE')",
            'audit DELETE',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'INSERT')",
            'audit INSERT',
          ],
          [
            "has_table_privilege(current_user, 'admin_bootstrap_markers', 'SELECT')",
            'bootstrap marker SELECT',
          ],
          [
            "has_table_privilege(current_user, 'admin_bootstrap_markers', 'INSERT')",
            'bootstrap marker INSERT',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'UPDATE')",
            'audit UPDATE',
          ],
        ] as const;
        for (const [expression, label] of forbidden) {
          if (
            await scalar(maintenanceDataSource, `SELECT ${expression} AS value`)
          ) {
            throw new Error(`Maintenance principal unexpectedly has ${label}`);
          }
        }
      } finally {
        await maintenanceDataSource.destroy();
      }
    }

    await bootstrapDataSource.initialize();
    try {
      const bootstrapPrincipal = new URL(bootstrapUrl).username;
      const bootstrapRole: BootstrapRoleRow[] = await migrationDataSource.query(
        `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
             rolcanlogin, rolreplication, rolbypassrls
           FROM pg_catalog.pg_roles WHERE rolname = $1`,
        [bootstrapPrincipal],
      );
      const [role] = bootstrapRole;
      if (
        bootstrapRole.length !== 1 ||
        !role ||
        role.rolsuper ||
        role.rolcreaterole ||
        role.rolcreatedb ||
        !role.rolcanlogin ||
        role.rolreplication ||
        role.rolbypassrls
      ) {
        throw new Error('Bootstrap login role attributes are unsafe');
      }
      const memberships: LoginMembershipRow[] = await migrationDataSource.query(
        `SELECT parent.rolname, member.admin_option AS "adminOption",
             member.inherit_option AS "inheritOption",
             member.set_option AS "setOption"
           FROM pg_catalog.pg_auth_members member
           JOIN pg_catalog.pg_roles child ON child.oid = member.member
           JOIN pg_catalog.pg_roles parent ON parent.oid = member.roleid
           WHERE child.rolname = $1 ORDER BY parent.rolname`,
        [bootstrapPrincipal],
      );
      const [membership] = memberships;
      if (
        memberships.length !== 1 ||
        membership?.rolname !== 'cornerstone_admin_bootstrap' ||
        membership.adminOption ||
        !membership.inheritOption ||
        !membership.setOption
      ) {
        throw new Error('Bootstrap login role membership is unsafe');
      }
      const groupRole: BootstrapRoleRow[] = await migrationDataSource.query(
        `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
             rolcanlogin, rolreplication, rolbypassrls
           FROM pg_catalog.pg_roles
           WHERE rolname = 'cornerstone_admin_bootstrap'`,
      );
      const [group] = groupRole;
      if (
        groupRole.length !== 1 ||
        !group ||
        group.rolsuper ||
        group.rolcreaterole ||
        group.rolcreatedb ||
        group.rolcanlogin ||
        group.rolreplication ||
        group.rolbypassrls
      ) {
        throw new Error('Bootstrap group role attributes are unsafe');
      }
      const groupParents: RoleMembershipRow[] = await migrationDataSource.query(
        `WITH RECURSIVE parent_roles AS (
               SELECT member.roleid
               FROM pg_catalog.pg_auth_members member
               JOIN pg_catalog.pg_roles child ON child.oid = member.member
               WHERE child.rolname = 'cornerstone_admin_bootstrap'
               UNION
               SELECT member.roleid
               FROM pg_catalog.pg_auth_members member
               JOIN parent_roles parent ON parent.roleid = member.member
             )
             SELECT role.rolname
             FROM parent_roles parent
             JOIN pg_catalog.pg_roles role ON role.oid = parent.roleid`,
      );
      if (groupParents.length !== 0) {
        throw new Error('Bootstrap group role has unsafe parent membership');
      }
      const groupMembers: LoginMembershipRow[] =
        await migrationDataSource.query(
          `SELECT child.rolname, member.admin_option AS "adminOption",
             member.inherit_option AS "inheritOption",
             member.set_option AS "setOption"
           FROM pg_catalog.pg_auth_members member
           JOIN pg_catalog.pg_roles child ON child.oid = member.member
           JOIN pg_catalog.pg_roles parent ON parent.oid = member.roleid
           WHERE parent.rolname = 'cornerstone_admin_bootstrap'
           ORDER BY child.rolname`,
        );
      if (
        groupMembers.length !== 1 ||
        groupMembers[0]?.rolname !== bootstrapPrincipal ||
        groupMembers[0].adminOption ||
        !groupMembers[0].inheritOption ||
        !groupMembers[0].setOption
      ) {
        throw new Error('Bootstrap group role membership is unsafe');
      }
      const loginDescendants: RoleMembershipRow[] =
        await migrationDataSource.query(
          `WITH RECURSIVE child_roles AS (
             SELECT member.member
             FROM pg_catalog.pg_auth_members member
             JOIN pg_catalog.pg_roles parent ON parent.oid = member.roleid
             WHERE parent.rolname = $1
             UNION
             SELECT member.member
             FROM pg_catalog.pg_auth_members member
             JOIN child_roles child ON child.member = member.roleid
           )
           SELECT role.rolname
           FROM child_roles child
           JOIN pg_catalog.pg_roles role ON role.oid = child.member`,
          [bootstrapPrincipal],
        );
      if (loginDescendants.length !== 0) {
        throw new Error('Bootstrap login role has unsafe descendants');
      }
      const functionContract: BootstrapFunctionRow[] =
        await migrationDataSource.query(
          `SELECT owner.rolname AS owner, procedure.prosecdef,
             procedure.proconfig
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
           JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
           WHERE namespace.nspname = 'public'
             AND procedure.proname = 'cornerstone_bootstrap_initial_admin'
             AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
               = 'requested_user_id uuid, requested_audit_id uuid, requested_email text, requested_password_hash text, requested_request_id text'`,
        );
      const [bootstrapFunction] = functionContract;
      if (
        functionContract.length !== 1 ||
        !bootstrapFunction ||
        !bootstrapFunction.prosecdef ||
        bootstrapFunction.owner !==
          new URL(
            environment.DATABASE_MIGRATION_URL ?? environment.DATABASE_URL,
          ).username ||
        bootstrapFunction.proconfig?.join(',') !== 'search_path=pg_catalog'
      ) {
        throw new Error('Bootstrap function security contract is invalid');
      }
      const functionGrantees: FunctionGrantRow[] =
        await migrationDataSource.query(
          `SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS rolname,
             acl.is_grantable AS "isGrantable"
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = procedure.pronamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
           ) acl
           LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
           WHERE namespace.nspname = 'public'
             AND procedure.proname = 'cornerstone_bootstrap_initial_admin'
             AND acl.privilege_type = 'EXECUTE'
           ORDER BY rolname`,
        );
      const expectedFunctionGrantees = [
        'cornerstone_admin_bootstrap',
        bootstrapFunction.owner,
      ].sort();
      if (
        functionGrantees.map(({ rolname }) => rolname).join(',') !==
          expectedFunctionGrantees.join(',') ||
        functionGrantees.some(
          ({ rolname, isGrantable }) =>
            rolname === 'cornerstone_admin_bootstrap' && isGrantable,
        )
      ) {
        throw new Error('Bootstrap function EXECUTE ACL is unsafe');
      }
      const publicExecute = Number(
        await scalar(
          migrationDataSource,
          `SELECT count(*)::integer AS value
             FROM pg_catalog.pg_proc procedure
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid = procedure.pronamespace
             CROSS JOIN LATERAL pg_catalog.aclexplode(
               COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
             ) acl
             WHERE namespace.nspname = 'public'
               AND procedure.proname = 'cornerstone_bootstrap_initial_admin'
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'`,
        ),
      );
      if (publicExecute !== 0) {
        throw new Error('PUBLIC can execute the bootstrap function');
      }
      const directRelationPrivileges = Number(
        await scalar(
          bootstrapDataSource,
          `SELECT count(*)::integer AS value
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND (
                 has_any_column_privilege(
                   current_user,
                   format('%I.%I', table_schema, table_name),
                   'SELECT,INSERT,UPDATE,REFERENCES'
                 )
                 OR has_table_privilege(
                   current_user,
                   format('%I.%I', table_schema, table_name),
                   'DELETE,TRUNCATE,TRIGGER'
                 )
               )`,
        ),
      );
      if (directRelationPrivileges !== 0) {
        throw new Error('Bootstrap principal has direct relation privileges');
      }
      const allowed = [
        [
          "has_function_privilege(current_user, 'public.cornerstone_bootstrap_initial_admin(uuid,uuid,text,text,text)', 'EXECUTE')",
          'bootstrap function EXECUTE',
        ],
      ] as const;
      for (const [expression, label] of allowed) {
        if (
          !(await scalar(bootstrapDataSource, `SELECT ${expression} AS value`))
        ) {
          throw new Error(`Bootstrap principal is missing ${label}`);
        }
      }
      const forbidden = [
        ["has_schema_privilege(current_user, 'public', 'CREATE')", 'DDL'],
        [
          "has_table_privilege(current_user, 'users', 'UPDATE')",
          'users UPDATE',
        ],
        [
          "has_table_privilege(current_user, 'users', 'DELETE')",
          'users DELETE',
        ],
        [
          "has_table_privilege(current_user, 'users', 'SELECT')",
          'users SELECT',
        ],
        [
          "has_table_privilege(current_user, 'users', 'INSERT')",
          'users INSERT',
        ],
        [
          "has_column_privilege(current_user, 'users', 'email_normalized', 'SELECT')",
          'users email SELECT',
        ],
        [
          "has_column_privilege(current_user, 'users', 'password_hash', 'SELECT')",
          'users password hash SELECT',
        ],
        [
          "has_table_privilege(current_user, 'audit_events', 'SELECT')",
          'audit SELECT',
        ],
        [
          "has_table_privilege(current_user, 'audit_events', 'UPDATE')",
          'audit UPDATE',
        ],
        [
          "has_table_privilege(current_user, 'audit_events', 'DELETE')",
          'audit DELETE',
        ],
        [
          "has_table_privilege(current_user, 'audit_events', 'INSERT')",
          'audit INSERT',
        ],
        [
          "has_table_privilege(current_user, 'admin_bootstrap_markers', 'SELECT')",
          'marker SELECT',
        ],
        [
          "has_table_privilege(current_user, 'admin_bootstrap_markers', 'INSERT')",
          'marker INSERT',
        ],
      ] as const;
      for (const [expression, label] of forbidden) {
        if (
          await scalar(bootstrapDataSource, `SELECT ${expression} AS value`)
        ) {
          throw new Error(`Bootstrap principal unexpectedly has ${label}`);
        }
      }
    } finally {
      await bootstrapDataSource.destroy();
    }
  } finally {
    await migrationDataSource.destroy();
  }

  process.stdout.write('Database contract verification: OK\n');
}

async function expectLockContention(runner: QueryRunner): Promise<void> {
  try {
    await acquireMigrationLock(runner, 50);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'Another migration runner holds the advisory lock'
    ) {
      return;
    }
    throw error;
  }

  await releaseMigrationLock(runner);
  throw new Error('Concurrent migration advisory lock was not rejected');
}

void verify().catch((error: unknown) => {
  const message = safeErrorMessage(error, 'Verification failed');
  process.stderr.write(`Database verification failed: ${message}\n`);
  process.exitCode = 1;
});

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.trim()) return error.message;
  const code = Reflect.get(error, 'code') as unknown;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

function buildBootstrapVerificationOptions(
  value: string,
  environment: DatabaseEnvironmentVariables,
): DataSourceOptions {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.hostname ||
    url.pathname === '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid bootstrap database verification URL');
  }
  return {
    type: 'postgres',
    url: value,
    ssl:
      environment.DATABASE_SSL_MODE === 'verify-full'
        ? {
            rejectUnauthorized: true,
            ...(environment.DATABASE_SSL_CA
              ? { ca: environment.DATABASE_SSL_CA }
              : {}),
          }
        : false,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    connectTimeoutMS: environment.DATABASE_CONNECT_TIMEOUT_MS,
    extra: {
      application_name: 'cornerstone-admin-bootstrap-verifier',
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      lock_timeout: environment.DATABASE_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    },
  };
}
