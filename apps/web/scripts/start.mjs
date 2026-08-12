import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveWebConfig } from '../src/config/web.ts'

resolveWebConfig(process.env, { requireSecureOrigin: true })

const nextBinary = resolve(import.meta.dirname, '../node_modules/next/dist/bin/next')
const result = spawnSync(process.execPath, [nextBinary, 'start', ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
