import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openapiConfig } from '../openapi.config.ts'

const command = process.argv[2]
if (command !== 'generate' && command !== 'check') {
  throw new Error('Expected generate or check')
}

const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const temporaryDirectory =
  command === 'check' ? mkdtempSync(join(tmpdir(), 'cornerstone-client-')) : undefined
const output = temporaryDirectory ? join(temporaryDirectory, 'schema.ts') : openapiConfig.output

try {
  run([
    'exec',
    'openapi-typescript',
    openapiConfig.schema,
    '--output',
    output,
    ...openapiConfig.arguments,
  ])
  run(['exec', 'prettier', '--config', openapiConfig.prettierConfig, '--write', output])

  if (command === 'check') {
    const current = readFileSync(openapiConfig.output, 'utf8')
    const generated = readFileSync(output, 'utf8')
    if (current !== generated) {
      throw new Error('API client drift detected; run client:generate')
    }
    process.stdout.write('API client check: OK\n')
  }
} finally {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
}

function run(arguments_) {
  const result = spawnSync(executable, arguments_, { encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${arguments_.join(' ')} failed with ${result.status ?? 1}`)
  }
}
