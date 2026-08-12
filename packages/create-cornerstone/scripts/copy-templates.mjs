import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  canonicalTemplateMetadataSchema,
  validateCanonicalOwnership,
} from '../dist/composition/template.js'

const packageRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(packageRoot, '..', '..')
const workspaceRealRoot = realpathSync(workspaceRoot)
const source = resolve(workspaceRoot, 'templates', 'canonical')
const target = resolve(packageRoot, 'dist', 'templates', 'canonical')

if (!target.startsWith(`${resolve(packageRoot, 'dist')}${sep}`)) {
  throw new Error('Refusing to write templates outside package dist')
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
const trackedCanonicalSources = new Set(trackedFiles('templates/canonical'))
assertCanonicalSourceTree(source, trackedCanonicalSources)
cpSync(source, target, { recursive: true, dereference: false, errorOnExist: false })

const metadata = canonicalTemplateMetadataSchema.parse(
  JSON.parse(readFileSync(join(source, 'standard.json'), 'utf8')),
)
const fragmentFiles = {}

for (const fragment of metadata.fragments) {
  const files = new Set()
  for (const mapping of fragment.mappings) {
    for (const sourcePath of trackedFiles(mapping.source)) {
      if ((mapping.exclude ?? []).some((excluded) => isWithin(sourcePath, excluded))) continue
      assertSafeSnapshotPath(sourcePath)
      const absoluteSource = resolve(workspaceRoot, sourcePath)
      const info = lstatSync(absoluteSource)
      if (info.isSymbolicLink()) throw new Error(`Template symlinks are not allowed: ${sourcePath}`)
      if (!info.isFile()) throw new Error(`Template snapshot source must be a file: ${sourcePath}`)
      files.add(sourcePath)
    }
  }
  fragmentFiles[fragment.id] = [...files].sort()
}

validateCanonicalOwnership(fragmentFiles, metadata.composers)

for (const [fragment, files] of Object.entries(fragmentFiles)) {
  for (const sourcePath of files) {
    const destination = join(target, 'fragments', fragment, encodePackedPath(sourcePath))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(resolve(workspaceRoot, sourcePath), destination)
  }
}

for (const composer of metadata.composers) {
  if (!composer.source) continue
  const matches = trackedFiles(composer.source)
  if (matches.length !== 1 || matches[0] !== composer.source) {
    throw new Error(`Composer source must name one explicit tracked file: ${composer.source}`)
  }
  assertSafeSnapshotPath(composer.source)
  const absoluteSource = resolve(workspaceRoot, composer.source)
  const info = lstatSync(absoluteSource)
  if (info.isSymbolicLink())
    throw new Error(`Template symlinks are not allowed: ${composer.source}`)
  const destination = join(target, 'composer-sources', composer.id)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(absoluteSource, destination)
}

function trackedFiles(path) {
  const result = spawnSync('git', ['--literal-pathspecs', 'ls-files', '-z', '--', path], {
    cwd: workspaceRoot,
    encoding: 'buffer',
  })
  if (result.status !== 0) {
    throw new Error(
      `Unable to resolve tracked template source ${path}: ${result.stderr.toString()}`,
    )
  }
  const files = result.stdout.toString('utf8').split('\0').filter(Boolean).sort()
  if (files.length === 0) throw new Error(`Template source is not git-tracked: ${path}`)
  return files
}

function assertSafeSnapshotPath(path) {
  if (path !== path.normalize('NFC')) throw new Error(`Template path must use NFC: ${path}`)
  const absolute = resolve(workspaceRoot, path)
  const real = realpathSync(absolute)
  const workspaceRelative = relative(workspaceRoot, absolute)
  const realRelative = relative(workspaceRealRoot, real)
  const normalizedRelative = workspaceRelative.split(sep).join('/')
  if (
    normalizedRelative.startsWith('..') ||
    normalizedRelative === '' ||
    normalizedRelative !== path
  ) {
    throw new Error(`Template path escapes the workspace: ${path}`)
  }
  if (realRelative.startsWith('..') || realRelative === '') {
    throw new Error(`Template source resolves outside the workspace: ${path}`)
  }
  const segments = path.split('/')
  if (segments.some((segment) => ['node_modules', 'dist', '.next'].includes(segment))) {
    throw new Error(`Generated artifacts are forbidden in template snapshots: ${path}`)
  }
  const basename = segments.at(-1)?.toLowerCase() ?? ''
  if (
    basename === '.env' ||
    /^\.env\.(?!example$)/.test(basename) ||
    /\.(pem|key|p12|pfx)$/.test(basename) ||
    basename === 'credentials.json'
  ) {
    throw new Error(`Environment or secret material is forbidden in template snapshots: ${path}`)
  }
}

function isWithin(path, excluded) {
  return path === excluded || path.startsWith(excluded.endsWith('/') ? excluded : `${excluded}/`)
}

function encodePackedPath(path) {
  return path
    .split('/')
    .map((segment) => (segment === '.gitignore' ? '__cornerstone_gitignore__' : segment))
    .join('/')
}

function assertCanonicalSourceTree(directory, trackedSources) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (directory === source && !['base', 'licenses', 'standard.json'].includes(entry.name)) {
      throw new Error(`Unexpected canonical template source: ${entry.name}`)
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Canonical template symlinks are not allowed: ${relative(source, path)}`)
    }
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.next'].includes(entry.name)) {
        throw new Error(`Generated directory is forbidden in canonical templates: ${entry.name}`)
      }
      assertCanonicalSourceTree(path, trackedSources)
    } else if (entry.isFile()) {
      const workspacePath = relative(workspaceRoot, path).split(sep).join('/')
      assertSafeSnapshotPath(workspacePath)
      if (!trackedSources.has(workspacePath)) {
        throw new Error(`Canonical template source is not git-tracked: ${workspacePath}`)
      }
    } else {
      throw new Error(`Unsupported canonical template entry: ${relative(source, path)}`)
    }
  }
}
