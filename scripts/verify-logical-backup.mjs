import { spawnSync } from 'node:child_process'

const compose = ['compose', '-f', 'infra/compose/compose.test.yml']
const sourceDatabase = 'cornerstone_test'
const restoreDatabase = 'cornerstone_restore_test'
const owner = 'cornerstone_test_owner'

function docker(args, options = {}) {
  const result = spawnSync('docker', [...compose, 'exec', '-T', 'postgres', ...args], {
    cwd: new URL('..', import.meta.url),
    input: options.input,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    throw new Error(
      `docker ${args[0]} failed: ${String(detail ?? '')
        .trim()
        .slice(0, 500)}`,
    )
  }
  return result.stdout
}

function fingerprint(database) {
  const output = docker([
    'psql',
    '-U',
    owner,
    '-d',
    database,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `SELECT json_build_object(
       'tables', (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'),
       'users', (SELECT count(*) FROM users),
       'audit', (SELECT count(*) FROM audit_events),
       'migrations', (SELECT count(*) FROM cornerstone_migrations),
       'user_checksum', (SELECT md5(COALESCE(string_agg(id::text || ':' || status || ':' || role, ',' ORDER BY id), '')) FROM users)
     )::text`,
  ])
  return String(output).trim()
}

let restoreCreated = false

try {
  const sourceFingerprint = fingerprint(sourceDatabase)
  const dump = docker(
    [
      'pg_dump',
      '-U',
      owner,
      '-d',
      sourceDatabase,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
    ],
    { binary: true },
  )
  if (!Buffer.isBuffer(dump) || dump.length === 0) {
    throw new Error('Logical backup produced an empty dump')
  }

  docker(['dropdb', '-U', owner, '--if-exists', restoreDatabase])
  docker(['createdb', '-U', owner, restoreDatabase])
  restoreCreated = true
  docker(
    [
      'pg_restore',
      '-U',
      owner,
      '-d',
      restoreDatabase,
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
    ],
    { input: dump },
  )

  if (fingerprint(restoreDatabase) !== sourceFingerprint) {
    throw new Error('Restored database fingerprint does not match the source')
  }
  console.log(`Logical backup/restore verification: OK (${dump.length} bytes)`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Logical backup verification failed')
  process.exitCode = 1
} finally {
  if (restoreCreated) {
    try {
      docker(['dropdb', '-U', owner, '--if-exists', restoreDatabase])
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Restore database cleanup failed')
      process.exitCode = 1
    }
  }
}
