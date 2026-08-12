import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const publishable = [
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
const expectedVersion = '0.1.0'
const errors = []

for (const directory of publishable) {
  const root = join('packages', directory)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  if (manifest.private === true) errors.push(`${manifest.name}: private package`)
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

for (const application of readdirSync('apps', { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
)) {
  const appName = JSON.parse(
    readFileSync(join('apps', application.name, 'package.json'), 'utf8'),
  ).name
  for (const directory of publishable) {
    const manifest = JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8'))
    if (Object.hasOwn(manifest.dependencies ?? {}, appName)) {
      errors.push(`${manifest.name}: reverse dependency on app ${appName}`)
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`Package boundary check: OK (${publishable.length} publishable packages)`)
