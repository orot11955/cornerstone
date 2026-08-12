import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const task = process.argv[2]
if (!['test:integration', 'test:e2e'].includes(task)) {
  console.error('Expected test:integration or test:e2e')
  process.exit(1)
}
const databaseEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test',
  DATABASE_MIGRATION_URL:
    'postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test',
}

function run(args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: options.database ? databaseEnvironment : process.env,
    encoding: 'utf8',
    stdio: options.quiet ? 'ignore' : 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`pnpm ${args.join(' ')} failed with ${result.status ?? 1}`)
  }
  return result.status ?? 1
}

let cleanupNeeded = false

try {
  run(['db:test:down'], { allowFailure: true, quiet: true })
  cleanupNeeded = true
  run(['db:test:up'])
  run(['migration:check'])
  run(['migration:run'], { database: true })
  run(['migration:revert'], { database: true })
  run(['migration:run'], { database: true })
  run(['seed'], { database: true })
  run(['seed'], { database: true })
  run(['exec', 'node', 'scripts/test-scope.mjs', task, '--run'], {
    database: true,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database integration failed')
  process.exitCode = 1
} finally {
  if (cleanupNeeded) {
    const status = run(['db:test:down'], { allowFailure: true })
    if (status !== 0) process.exitCode = 1
  }
}
