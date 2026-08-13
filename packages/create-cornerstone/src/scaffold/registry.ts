import { z } from 'zod'
import { sha256, stableJson } from '../hash.js'

export const scaffoldKindSchema = z.enum(['package', 'feature', 'api', 'migration'])
export type ScaffoldKind = z.infer<typeof scaffoldKindSchema>

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]{0,62}\/)?[a-z0-9][a-z0-9._-]{0,62}$/
const legacyNamedScaffoldPattern = /^[a-z][a-z0-9-]{1,62}$/
const namedScaffoldPattern = /^(?=.{2,63}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const migrationScaffoldPattern = /^[A-Z][A-Za-z0-9]*$/
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const windowsInvalidCharacterPattern = /[<>:"|?*]/

export const scaffoldPathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((path, context) => {
    if (path !== path.normalize('NFC')) {
      context.addIssue({ code: 'custom', message: 'Scaffold path must use NFC normalization' })
    }
    const segments = path.split('/')
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.endsWith('/') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scaffold path must be a normalized POSIX relative path',
      })
    }
    for (const segment of segments) {
      if (
        windowsReservedNamePattern.test(segment) ||
        windowsInvalidCharacterPattern.test(segment) ||
        /[ .]$/.test(segment)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Scaffold path must be portable and cannot contain Windows-reserved segments',
        })
      }
    }
  })

const scaffoldRegistryEntryBaseSchema = z.object({
  id: z.string().min(1).max(192),
  kind: scaffoldKindSchema,
  name: z.string().min(1).max(128),
  optionsDigest: digestSchema,
  paths: z.array(scaffoldPathSchema).min(1),
})

const scaffoldRegistryEntryV1Schema = scaffoldRegistryEntryBaseSchema
  .extend({ version: z.literal(1) })
  .strict()

const scaffoldRegistryEntryV2Schema = z.discriminatedUnion('kind', [
  scaffoldRegistryEntryBaseSchema
    .extend({
      version: z.literal(2),
      kind: z.literal('package'),
      options: z.object({ visibility: z.literal('private') }).strict(),
    })
    .strict(),
  scaffoldRegistryEntryBaseSchema
    .extend({
      version: z.literal(2),
      kind: z.literal('feature'),
      options: z.object({}).strict(),
    })
    .strict(),
  scaffoldRegistryEntryBaseSchema
    .extend({
      version: z.literal(2),
      kind: z.literal('api'),
      options: z.object({ exposure: z.literal('contract-only') }).strict(),
    })
    .strict(),
  scaffoldRegistryEntryBaseSchema
    .extend({
      version: z.literal(2),
      kind: z.literal('migration'),
      options: z
        .object({ timestamp: z.number().int().min(1_000_000_000_000).max(9_999_999_999_999) })
        .strict(),
    })
    .strict(),
])

export const scaffoldRegistryEntrySchema = z
  .union([scaffoldRegistryEntryV1Schema, scaffoldRegistryEntryV2Schema])
  .superRefine((entry, context) => {
    if (entry.name !== entry.name.normalize('NFC')) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Scaffold name must use NFC normalization',
      })
    }
    const validName = isValidScaffoldName(entry.kind, entry.name, entry.version)
    if (!validName) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: `Invalid ${entry.kind} scaffold name`,
      })
    }
    const portableNameSegments = entry.name.replace(/^@/, '').split('/')
    if (
      portableNameSegments.some(
        (segment) => windowsReservedNamePattern.test(segment) || /[ .]$/.test(segment),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Scaffold name cannot use a Windows-reserved name or trailing dot/space',
      })
    }
    if (entry.id !== canonicalScaffoldId(entry.kind, entry.name)) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Scaffold id must equal the canonical kind:name relationship',
      })
    }
    if (!isStrictlySorted(entry.paths)) {
      context.addIssue({
        code: 'custom',
        path: ['paths'],
        message: 'Scaffold paths must be sorted',
      })
    }
    const paths = new Set<string>()
    entry.paths.forEach((path, index) => {
      const canonical = portablePathKey(path)
      if (paths.has(canonical)) {
        context.addIssue({
          code: 'custom',
          path: ['paths', index],
          message: 'Duplicate scaffold path after portable case folding',
        })
      }
      paths.add(canonical)
    })
  })

export const scaffoldRegistrySchema = z
  .array(scaffoldRegistryEntrySchema)
  .superRefine((entries, context) => {
    if (!isStrictlySorted(entries.map(({ id }) => id))) {
      context.addIssue({ code: 'custom', message: 'Scaffold registry must be sorted by id' })
    }
    const ids = new Set<string>()
    const paths: string[] = []
    entries.forEach((entry, entryIndex) => {
      const idKey = entry.id.normalize('NFC').toLowerCase()
      if (ids.has(idKey)) {
        context.addIssue({
          code: 'custom',
          path: [entryIndex, 'id'],
          message: 'Duplicate scaffold id after portable case folding',
        })
      }
      ids.add(idKey)
      entry.paths.forEach((path, pathIndex) => {
        const pathKey = portablePathKey(path)
        if (paths.some((existing) => portablePathsConflict(existing, pathKey))) {
          context.addIssue({
            code: 'custom',
            path: [entryIndex, 'paths', pathIndex],
            message: 'Scaffold paths must be globally unique without ancestor/descendant conflicts',
          })
        }
        paths.push(pathKey)
      })
    })
  })

export type ScaffoldRegistryEntry = z.infer<typeof scaffoldRegistryEntrySchema>

export function canonicalScaffoldId(kind: ScaffoldKind, name: string): string {
  return `${kind}:${name}`
}

export function assertScaffoldName(kind: ScaffoldKind, name: string): void {
  if (!isValidScaffoldName(kind, name, 2)) {
    throw new Error(`Invalid ${kind} scaffold name`)
  }
}

export function computeScaffoldsDigest(entries: readonly ScaffoldRegistryEntry[]): string {
  return sha256(stableJson(entries))
}

export function computeScaffoldOptionsDigest(
  kind: ScaffoldKind,
  options: Readonly<Record<string, string | number>> = {},
): string {
  return sha256(stableJson(canonicalScaffoldOptions(kind, options)))
}

export function validateScaffoldOptionsDigest(entry: ScaffoldRegistryEntry): void {
  if (entry.version === 1) return
  if (entry.optionsDigest !== sha256(stableJson(entry.options))) {
    throw new Error(`Scaffold options digest is not canonical: ${entry.id}`)
  }
  if (
    entry.kind === 'migration' &&
    entry.options.timestamp !== migrationTimestampFromPaths(entry.name, entry.paths)
  )
    throw new Error(`Migration scaffold timestamp does not match paths: ${entry.id}`)
}

export function validateScaffoldRegistry(
  input: unknown,
  occupiedOutputPaths: readonly string[] = [],
): ScaffoldRegistryEntry[] {
  const entries = scaffoldRegistrySchema.parse(input)
  const occupiedPaths = occupiedOutputPaths.map(portablePathKey)
  const migrationTimestamps = new Set<number>()
  for (const entry of entries) {
    validateScaffoldOptionsDigest(entry)
    if (entry.version === 2 && entry.kind === 'migration') {
      if (migrationTimestamps.has(entry.options.timestamp)) {
        throw new Error(`Duplicate migration timestamp: ${entry.options.timestamp}`)
      }
      migrationTimestamps.add(entry.options.timestamp)
    }
    for (const path of entry.paths) {
      const pathKey = portablePathKey(path)
      if (occupiedPaths.some((occupied) => portablePathsConflict(occupied, pathKey))) {
        throw new Error(`Scaffold path conflicts with an existing lock output: ${path}`)
      }
      if (isGeneratorControlPath(path)) {
        throw new Error(`Scaffold path conflicts with the generator control namespace: ${path}`)
      }
    }
  }
  return entries
}

function canonicalScaffoldOptions(
  kind: ScaffoldKind,
  options: Readonly<Record<string, string | number>>,
): Readonly<Record<string, string | number>> {
  const keys = Object.keys(options)
  if (kind === 'feature') {
    if (keys.length !== 0) throw new Error('feature scaffold does not accept options')
    return {}
  }
  if (kind === 'package') {
    if (keys.length !== 1 || options.visibility !== 'private')
      throw new Error('Package scaffold visibility must be private')
    return { visibility: 'private' }
  }
  if (kind === 'api') {
    if (keys.length !== 1 || options.exposure !== 'contract-only')
      throw new Error('API scaffold exposure must be contract-only')
    return { exposure: 'contract-only' }
  }
  if (keys.length !== 1 || keys[0] !== 'timestamp') {
    throw new Error('Migration scaffold requires only the timestamp option')
  }
  const candidate =
    typeof options.timestamp === 'string' && /^\d{13}$/.test(options.timestamp)
      ? Number(options.timestamp)
      : options.timestamp
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1_000_000_000_000 ||
    candidate > 9_999_999_999_999
  ) {
    throw new Error('Migration timestamp must be exactly 13 digits')
  }
  return { timestamp: candidate }
}

function migrationTimestampFromPaths(name: string, paths: readonly string[]): number {
  const pattern = new RegExp(
    `^apps/api/src/database/migrations/(\\d{13})-${escapeRegExp(name)}\\.(?:ts|metadata\\.json)$`,
  )
  const values = paths.map((path) => pattern.exec(path)?.[1]).filter(Boolean)
  if (values.length !== 2 || values[0] !== values[1]) {
    throw new Error(`Migration scaffold paths do not encode one canonical timestamp: ${name}`)
  }
  return Number(values[0])
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isValidScaffoldName(kind: ScaffoldKind, name: string, version: 1 | 2): boolean {
  if (kind === 'package') return packageNamePattern.test(name)
  if (kind === 'migration') return migrationScaffoldPattern.test(name)
  return (version === 1 ? legacyNamedScaffoldPattern : namedScaffoldPattern).test(name)
}

export function isGeneratorControlPath(path: string): boolean {
  const key = portablePathKey(path)
  return (
    key === '.cornerstone' ||
    key.startsWith('.cornerstone/') ||
    key === 'cornerstone.config.yml' ||
    key.startsWith('cornerstone.config.yml/')
  )
}

function portablePathKey(path: string): string {
  return path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')
}

export function portableScaffoldPathsConflict(left: string, right: string): boolean {
  return portablePathsConflict(portablePathKey(left), portablePathKey(right))
}

function portablePathsConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function isStrictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value)
}
