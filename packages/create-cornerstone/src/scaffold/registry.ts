import { z } from 'zod'
import { sha256, stableJson } from '../hash.js'

export const scaffoldKindSchema = z.enum(['package', 'feature', 'api', 'migration'])
export type ScaffoldKind = z.infer<typeof scaffoldKindSchema>

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]{0,62}\/)?[a-z0-9][a-z0-9._-]{0,62}$/
const namedScaffoldPattern = /^[a-z][a-z0-9-]{1,62}$/
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

export const scaffoldRegistryEntrySchema = z
  .object({
    id: z.string().min(1).max(192),
    kind: scaffoldKindSchema,
    version: z.literal(1),
    name: z.string().min(1).max(128),
    optionsDigest: digestSchema,
    paths: z.array(scaffoldPathSchema).min(1),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.name !== entry.name.normalize('NFC')) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Scaffold name must use NFC normalization',
      })
    }
    const validName =
      entry.kind === 'package'
        ? packageNamePattern.test(entry.name)
        : entry.kind === 'migration'
          ? migrationScaffoldPattern.test(entry.name)
          : namedScaffoldPattern.test(entry.name)
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

export function computeScaffoldsDigest(entries: readonly ScaffoldRegistryEntry[]): string {
  return sha256(stableJson(entries))
}

export function validateScaffoldRegistry(
  input: unknown,
  occupiedOutputPaths: readonly string[] = [],
): ScaffoldRegistryEntry[] {
  const entries = scaffoldRegistrySchema.parse(input)
  const occupiedPaths = occupiedOutputPaths.map(portablePathKey)
  for (const entry of entries) {
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
