import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const standardNames = [
  '@cornerstone/api-client',
  '@cornerstone/config',
  '@cornerstone/eslint-config',
  '@cornerstone/schemas',
  '@cornerstone/tsconfig',
  '@cornerstone/types',
  '@cornerstone/ui',
  '@cornerstone/utils',
]
const rootNames = [...standardNames, 'create-cornerstone'].sort()
const expectedVersion = '0.1.0'
const errors = []

const publishable = readdirSync('packages', { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join('packages', entry.name, 'package.json')),
  )
  .map((entry) => {
    const root = join('packages', entry.name)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return { directory: entry.name, root, manifest }
  })
  .filter(({ manifest }) => manifest.private !== true)
  .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))

const actualNames = publishable.map(({ manifest }) => manifest.name)
const expectedNames = actualNames.includes('create-cornerstone') ? rootNames : standardNames
if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())) {
  errors.push(
    `Publishable workspace set mismatch: expected ${[...expectedNames].sort().join(', ')}, found ${actualNames.join(', ')}`,
  )
}

for (const { root, manifest } of publishable) {
  if (manifest.version !== expectedVersion) errors.push(`${manifest.name}: version mismatch`)
  if (manifest.license !== 'ISC') errors.push(`${manifest.name}: license must be ISC`)
  if (!existsSync(join(root, 'LICENSE'))) errors.push(`${manifest.name}: LICENSE missing`)
  if (!existsSync(join(root, 'NOTICE'))) errors.push(`${manifest.name}: NOTICE missing`)

  for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
    const paths = typeof target === 'string' ? [target] : Object.values(target)
    for (const path of paths) {
      if (typeof path !== 'string') continue
      if (path.includes('/src/')) errors.push(`${manifest.name}${entry}: source export`)
      if (!existsSync(join(root, path))) errors.push(`${manifest.name}${entry}: missing ${path}`)
    }
  }

  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@cornerstone/') && !String(version).startsWith('workspace:^')) {
      errors.push(`${manifest.name}: ${name} must use workspace:^`)
    }
  }
}

for (const applicationRoot of ['apps', 'examples'].filter((root) => existsSync(root))) {
  for (const application of readdirSync(applicationRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  )) {
    const appName = JSON.parse(
      readFileSync(join(applicationRoot, application.name, 'package.json'), 'utf8'),
    ).name
    for (const { manifest } of publishable) {
      if (Object.hasOwn(manifest.dependencies ?? {}, appName)) {
        errors.push(`${manifest.name}: reverse dependency on app ${appName}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`Package boundary check: OK (${publishable.length} publishable packages)`)
