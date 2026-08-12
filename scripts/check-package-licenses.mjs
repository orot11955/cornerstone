import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const publishable = [
  '@cornerstone/api-client',
  '@cornerstone/config',
  '@cornerstone/eslint-config',
  '@cornerstone/schemas',
  '@cornerstone/tsconfig',
  '@cornerstone/types',
  '@cornerstone/ui',
  '@cornerstone/utils',
  'create-cornerstone',
]
const allowed = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT'])

const result = spawnSync('pnpm', ['list', '--prod', '--json', '--depth', 'Infinity'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const workspaces = JSON.parse(result.stdout)
const roots = workspaces.filter((workspace) => publishable.includes(workspace.name))
const packages = new Map()
const errors = []

function normalizeLicense(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => normalizeLicense(entry))
  if (value && typeof value === 'object' && 'type' in value) return [value.type]
  return []
}

function visit(node) {
  if (!node?.path || packages.has(node.path)) return
  const manifest = JSON.parse(readFileSync(join(node.path, 'package.json'), 'utf8'))
  const licenses = normalizeLicense(manifest.license ?? manifest.licenses)
  packages.set(node.path, {
    name: manifest.name,
    version: manifest.version,
    licenses,
  })
  if (licenses.length === 0) errors.push(`${manifest.name}@${manifest.version}: license missing`)
  for (const license of licenses) {
    if (!allowed.has(license)) {
      errors.push(`${manifest.name}@${manifest.version}: license not allowed (${license})`)
    }
  }
  for (const dependency of Object.values(node.dependencies ?? {})) visit(dependency)
}

for (const workspace of roots) visit(workspace)

if (roots.length !== publishable.length) {
  errors.push(`Expected ${publishable.length} publishable workspaces, found ${roots.length}`)
}

const reportPath = join(root, '.artifacts', 'dependency-licenses.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      allowed: [...allowed].sort(),
      packages: [...packages.values()].sort((a, b) =>
        `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
      ),
    },
    null,
    2,
  )}\n`,
)

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`Package license check: OK (${packages.size} packages)`)
