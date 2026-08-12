import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const allowed = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT'])
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const errors = []

function pnpmList(args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return JSON.parse(result.stdout)
}

const workspaceEntries = pnpmList(['list', '--recursive', '--depth', '-1', '--json'])
const publishable = workspaceEntries
  .map((entry) => {
    const manifestPath = join(entry.path, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return { entry, manifest, manifestPath }
  })
  .filter(({ manifest }) => manifest.private !== true)
  .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))

if (publishable.length === 0) errors.push('No publishable workspaces discovered')
const names = new Set()
for (const { manifest, manifestPath } of publishable) {
  if (!manifest.name || names.has(manifest.name)) {
    errors.push(`${manifestPath}: publishable workspace name is missing or duplicated`)
  }
  names.add(manifest.name)
  for (const filename of ['LICENSE', 'NOTICE']) {
    if (!existsSync(join(dirname(manifestPath), filename))) {
      errors.push(`${manifest.name}: ${filename} missing`)
    }
  }
}

const dependencyRoots = pnpmList(['list', '--prod', '--recursive', '--json', '--depth', 'Infinity'])
const dependencyRootsByPath = new Map(dependencyRoots.map((entry) => [resolve(entry.path), entry]))
const packages = new Map()

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
  packages.set(node.path, { name: manifest.name, version: manifest.version, licenses })
  if (licenses.length === 0) errors.push(`${manifest.name}@${manifest.version}: license missing`)
  for (const license of licenses) {
    if (!allowed.has(license)) {
      errors.push(`${manifest.name}@${manifest.version}: license not allowed (${license})`)
    }
  }
  for (const dependency of Object.values(node.dependencies ?? {})) visit(dependency)
}

for (const workspace of publishable) {
  const rootEntry = dependencyRootsByPath.get(resolve(workspace.entry.path))
  if (!rootEntry) errors.push(`${workspace.manifest.name}: missing from pnpm production graph`)
  else visit(rootEntry)
}

const reportPath = join(root, '.artifacts', 'dependency-licenses.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      allowed: [...allowed].sort(),
      publishableWorkspaces: publishable.map(({ manifest }) => manifest.name),
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

console.log(
  `Package license check: OK (${publishable.length} publishable workspaces, ${packages.size} packages)`,
)
