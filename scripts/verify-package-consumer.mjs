import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const artifacts = join(root, '.artifacts', 'packages')
const packageDirectories = [
  'api-client',
  'config',
  'create-cornerstone',
  'eslint-config',
  'schemas',
  'tsconfig',
  'types',
  'ui',
  'utils',
]

rmSync(artifacts, { recursive: true, force: true })
mkdirSync(artifacts, { recursive: true })

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

run('pnpm', ['build'])
run('node', ['scripts/validate-package-boundaries.mjs'])

const tarballs = []
for (const directory of packageDirectories) {
  const output = run('pnpm', [
    '--dir',
    join('packages', directory),
    'pack',
    '--pack-destination',
    artifacts,
    '--json',
  ])
  const result = JSON.parse(output)
  const filename = result.filename ?? result[0]?.filename
  if (!filename) throw new Error(`pnpm pack did not return a filename for ${directory}`)
  tarballs.push(resolve(join('packages', directory), filename))
}

const consumer = mkdtempSync(join(tmpdir(), 'cornerstone-package-consumer-'))
const dependencies = Object.fromEntries(
  tarballs.map((tarball) => {
    const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']))
    const entries = run('tar', ['-tf', tarball]).split('\n')
    if (!entries.includes('package/LICENSE')) {
      throw new Error(`${manifest.name} tarball does not contain LICENSE`)
    }
    if (!entries.includes('package/NOTICE')) {
      throw new Error(`${manifest.name} tarball does not contain NOTICE`)
    }
    if (entries.some((entry) => entry.startsWith('package/src/'))) {
      throw new Error(`${manifest.name} tarball contains package source files`)
    }
    return [manifest.name, `file:${tarball}`]
  }),
)

writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify(
    {
      name: 'cornerstone-external-consumer',
      private: true,
      type: 'module',
      scripts: { typecheck: 'tsc --noEmit', start: 'node index.mjs' },
      dependencies,
      devDependencies: { typescript: '5.9.3' },
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  join(consumer, 'pnpm-workspace.yaml'),
  `packages: []\noverrides:\n${Object.entries(dependencies)
    .filter(([name]) => name.startsWith('@cornerstone/'))
    .map(([name, tarball]) => `  '${name}': '${tarball}'`)
    .join('\n')}\n`,
)
writeFileSync(
  join(consumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      extends: '@cornerstone/tsconfig/node.json',
      compilerOptions: {
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2023',
      },
      include: ['index.ts'],
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  join(consumer, 'index.ts'),
  "import { createApiClient } from '@cornerstone/api-client'\nimport { definePublicConfig } from '@cornerstone/config'\nimport { paginationSchema } from '@cornerstone/schemas'\nimport type { Result } from '@cornerstone/types'\nimport type { Appearance } from '@cornerstone/ui'\nimport { ok } from '@cornerstone/utils'\nconst result: Result<number, never> = ok(1)\nconst appearance: Appearance = { theme: 'dark', style: 'industrial', brand: 'signal-violet', density: 'default' }\nvoid createApiClient({ baseUrl: 'https://example.test' })\nvoid definePublicConfig({ apiVersion: 'v1' })\nvoid paginationSchema.parse({})\nvoid result\nvoid appearance\n",
)
writeFileSync(
  join(consumer, 'index.mjs'),
  "import { createTypeScriptConfig } from '@cornerstone/eslint-config'\nimport { paginationSchema } from '@cornerstone/schemas'\nimport { ok } from '@cornerstone/utils'\nif (!ok(1).ok || paginationSchema.parse({}).page !== 1) process.exit(1)\nif (createTypeScriptConfig({ tsconfigRootDir: process.cwd() }).length < 1) process.exit(1)\nawait import('@cornerstone/config/server')\nawait import('@cornerstone/config/browser')\nawait import('@cornerstone/api-client/browser')\nawait import('@cornerstone/ui/browser')\nconsole.log('External consumer: OK')\n",
)

run('pnpm', ['install'], consumer)
run('pnpm', ['typecheck'], consumer)
const runtimeOutput = run('pnpm', ['start'], consumer).trim()

writeFileSync(
  join(root, '.artifacts', 'package-consumer-report.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      packages: tarballs.map((tarball) => basename(tarball)).sort(),
      workspaceLinks: false,
      typecheck: 'passed',
      runtime: runtimeOutput.includes('External consumer: OK') ? 'passed' : 'failed',
    },
    null,
    2,
  )}\n`,
)

if (!runtimeOutput.includes('External consumer: OK')) process.exit(1)
console.log(`Package consumer verification: OK (${tarballs.length} tarballs)`)
