import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const root = new URL('..', import.meta.url)
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const [apiPort, webPort] = await reservePorts(2)
const databaseEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(apiPort),
  WEB_URL: `http://127.0.0.1:${webPort}`,
  DATABASE_URL:
    'postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test',
  DATABASE_MIGRATION_URL:
    'postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test',
  DATABASE_MAINTENANCE_URL:
    'postgresql://cornerstone_test_maintenance:cornerstone-test-maintenance@localhost:55432/cornerstone_test',
  JWT_ACCESS_KID: 'test-access-v1',
  JWT_ACCESS_KEY: encode('cornerstone-test-access-key-v1-32-bytes'),
  REFRESH_TOKEN_KEY_VERSION: 'test-refresh-v1',
  REFRESH_TOKEN_PEPPER: encode('cornerstone-test-refresh-key-v1-32-bytes'),
  ACTION_TOKEN_KEY_VERSION: 'test-action-v1',
  ACTION_TOKEN_PEPPER: encode('cornerstone-test-action-key-v1-32-bytes'),
  CSRF_KEY_VERSION: 'test-csrf-v1',
  CSRF_SECRET: encode('cornerstone-test-csrf-key-v1-32-bytes'),
  RATE_LIMIT_SECRET: encode('cornerstone-test-rate-key-v1-32-bytes'),
  IDEMPOTENCY_SECRET: encode('cornerstone-test-idempotency-key-v1-32-bytes'),
  MAIL_OUTBOX_KEY_VERSION: 'test-mail-v1',
  MAIL_OUTBOX_KEY: encode('cornerstone-test-mail-key-v1-32b'),
  AUTH_SECRET_PROVENANCE: 'local',
}
const bootstrapEnvironment = {
  ...databaseEnvironment,
  DATABASE_ADMIN_BOOTSTRAP_URL:
    'postgresql://cornerstone_test_admin_bootstrap:cornerstone-test-admin-bootstrap@localhost:55432/cornerstone_test',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@cornerstone.test',
  ADMIN_BOOTSTRAP_REQUEST_ID: 'm6-web-auth-e2e',
}

let apiProcess
let databaseStarted = false
let temporaryDirectory

try {
  run(['db:test:down'], process.env, true)
  run(['db:test:up'])
  databaseStarted = true
  run(['migration:run'], databaseEnvironment)

  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'cornerstone-m6-auth-'))
  const passwordFile = path.join(temporaryDirectory, 'admin-password')
  const password = `E2e-${randomBytes(18).toString('base64url')}!`
  await writeFile(passwordFile, password, { mode: 0o600 })
  run(['admin:bootstrap'], {
    ...bootstrapEnvironment,
    ADMIN_BOOTSTRAP_PASSWORD_FILE: passwordFile,
  })

  run(['api:build'], databaseEnvironment)
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: databaseEnvironment,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitForApi(apiProcess)
  run(['--filter', 'web', 'test:e2e:auth'], {
    ...process.env,
    M6_E2E_API_PORT: String(apiPort),
    M6_E2E_WEB_PORT: String(webPort),
    M6_E2E_PASSWORD_FILE: passwordFile,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'M6 Web auth E2E failed')
  process.exitCode = 1
} finally {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill('SIGTERM')
    await waitForExit(apiProcess)
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  if (databaseStarted) run(['db:test:down'], process.env, true)
}

function run(arguments_, environment = databaseEnvironment, allowFailure = false) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`pnpm ${arguments_.join(' ')} failed with ${result.status ?? 1}`)
  }
}

async function waitForApi(child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited with ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/health/live`)
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (child.exitCode !== null) throw new Error(`API exited with ${child.exitCode}`)
        return
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API readiness timed out')
}

async function waitForExit(child) {
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

async function reservePorts(count) {
  const servers = []
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer()
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      servers.push(server)
    }
    return servers.map((server) => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Failed to reserve E2E port')
      return address.port
    })
  } finally {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    )
  }
}
