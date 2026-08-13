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

const apiMethodSchema = z.enum(['get', 'post', 'patch', 'delete'])
const apiAuthenticationSchema = z.enum(['anonymous', 'session'])
const apiRoles = ['user', 'admin'] as const
const apiPermissions = [
  'profile:read',
  'profile:update',
  'session:list',
  'session:revoke',
  'user:list',
  'user:read',
  'user:update-role',
  'user:update-status',
] as const
const apiRolePermissions = {
  user: ['profile:read', 'profile:update', 'session:list', 'session:revoke'],
  admin: apiPermissions,
} as const
export const apiAuthorizationContract = {
  roles: apiRoles,
  permissions: apiPermissions,
  rolePermissions: apiRolePermissions,
} as const
const apiRoleSchema = z.enum(apiRoles)
const apiPermissionSchema = z.enum(apiPermissions)
const apiPathSchema = z
  .string()
  .regex(
    /^\/(?:[a-z][a-z0-9-]*|\{[a-z][A-Za-z0-9]*Id\})(?:\/(?:[a-z][a-z0-9-]*|\{[a-z][A-Za-z0-9]*Id\}))*$/,
  )
const apiOperationIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{1,79}$/)
  .refine((value) => value !== 'constructor', 'API operation ID is reserved')
const apiV3OptionsSchema = z
  .object({
    method: apiMethodSchema,
    path: apiPathSchema,
    operationId: apiOperationIdSchema,
    authentication: apiAuthenticationSchema,
    csrf: z.boolean(),
    roles: z
      .array(apiRoleSchema)
      .min(0)
      .max(2)
      .superRefine((roles, context) => {
        if (
          new Set(roles).size !== roles.length ||
          roles.some(
            (role, index) =>
              index > 0 && apiRoles.indexOf(roles[index - 1]!) > apiRoles.indexOf(role),
          )
        )
          context.addIssue({
            code: 'custom',
            message: 'API roles must be unique and in canonical order',
          })
      }),
    permission: apiPermissionSchema.nullable(),
    ownership: z.literal('none'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === 'get' && value.csrf)
      context.addIssue({
        code: 'custom',
        path: ['csrf'],
        message: 'GET API routes must disable CSRF',
      })
    if (value.method !== 'get' && !value.csrf)
      context.addIssue({
        code: 'custom',
        path: ['csrf'],
        message: 'Unsafe API routes must require CSRF',
      })
    if (
      value.authentication === 'anonymous' &&
      (value.roles.length !== 0 || value.permission !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Anonymous API routes cannot have roles or permissions',
      })
    if (value.authentication === 'session' && value.roles.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['roles'],
        message: 'Session API routes require roles',
      })
    if (value.authentication === 'session' && value.permission === null)
      context.addIssue({
        code: 'custom',
        path: ['permission'],
        message: 'Session API routes require a permission',
      })
    if (
      value.authentication === 'session' &&
      value.path.includes('{') &&
      (value.roles.length !== 1 || value.roles[0] !== 'admin')
    )
      context.addIssue({
        code: 'custom',
        path: ['roles'],
        message:
          'Parameterized session API routes require the admin role until ownership is enforced',
      })
    if (
      value.permission &&
      value.roles.some(
        (role) => !(apiRolePermissions[role] as readonly string[]).includes(value.permission!),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['permission'],
        message: 'Permission is not granted to every selected role',
      })
  })

const scaffoldRegistryEntryV3Schema = scaffoldRegistryEntryBaseSchema
  .extend({
    version: z.literal(3),
    kind: z.literal('api'),
    options: apiV3OptionsSchema,
  })
  .strict()

export const scaffoldRegistryEntrySchema = z
  .union([
    scaffoldRegistryEntryV1Schema,
    scaffoldRegistryEntryV2Schema,
    scaffoldRegistryEntryV3Schema,
  ])
  .superRefine((entry, context) => {
    if (entry.name !== entry.name.normalize('NFC')) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Scaffold name must use NFC normalization',
      })
    }
    const validName = isValidScaffoldName(entry.kind, entry.name, entry.version === 1 ? 1 : 2)
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

export function assertApiV3RouteDoesNotCollide(
  entries: readonly ScaffoldRegistryEntry[],
  options: z.infer<typeof apiV3OptionsSchema>,
): void {
  const knownRoutes = [
    'get /api/v1/health/live',
    'get /api/v1/health/ready',
    'get /api/v1/auth/csrf',
    'post /api/v1/auth/register',
    'post /api/v1/auth/verify-email',
    'post /api/v1/auth/verification/resend',
    'post /api/v1/auth/login',
    'post /api/v1/auth/refresh',
    'post /api/v1/auth/password/forgot',
    'post /api/v1/auth/password/reset',
    'get /api/v1/auth/me',
    'post /api/v1/auth/logout',
    'post /api/v1/auth/password/change',
    'post /api/v1/auth/recent-auth',
    'get /api/v1/auth/sessions',
    'delete /api/v1/auth/sessions/{sessionId}',
    'delete /api/v1/auth/sessions',
    'delete /api/v1/users/me',
    'get /api/v1/users',
    'get /api/v1/users/{userId}',
    'patch /api/v1/users/{userId}/role',
    'patch /api/v1/users/{userId}/status',
  ].map(parseRoute)
  const operations = new Set([
    'getLiveness',
    'getReadiness',
    'getCsrfToken',
    'register',
    'verifyEmail',
    'resendVerification',
    'login',
    'refreshSession',
    'requestPasswordReset',
    'resetPassword',
    'getCurrentUser',
    'logout',
    'changePassword',
    'confirmRecentAuthentication',
    'listSessions',
    'revokeSession',
    'revokeAllSessions',
    'deleteCurrentUser',
    'listUsers',
    'getUser',
    'updateUserRole',
    'updateUserStatus',
  ])
  for (const entry of entries)
    if (entry.version === 3 && entry.kind === 'api') {
      knownRoutes.push({ method: entry.options.method, path: `/api/v1${entry.options.path}` })
      operations.add(entry.options.operationId)
    }
  const candidate = { method: options.method, path: `/api/v1${options.path}` }
  if (knownRoutes.some((route) => apiRoutesOverlap(route, candidate))) {
    throw new Error(`API route already exists or overlaps: ${candidate.method} ${candidate.path}`)
  }
  if (operations.has(options.operationId))
    throw new Error(`API operation ID already exists: ${options.operationId}`)
}

interface ApiRouteShape {
  readonly method: string
  readonly path: string
}

function parseRoute(value: string): ApiRouteShape {
  const separator = value.indexOf(' ')
  return { method: value.slice(0, separator), path: value.slice(separator + 1) }
}

function apiRoutesOverlap(left: ApiRouteShape, right: ApiRouteShape): boolean {
  if (left.method !== right.method) return false
  const leftSegments = left.path.split('/')
  const rightSegments = right.path.split('/')
  return (
    leftSegments.length === rightSegments.length &&
    leftSegments.every(
      (segment, index) =>
        segment === rightSegments[index] ||
        /^\{[a-z][A-Za-z0-9]*Id\}$/.test(segment) ||
        /^\{[a-z][A-Za-z0-9]*Id\}$/.test(rightSegments[index] ?? ''),
    )
  )
}

export function computeScaffoldsDigest(entries: readonly ScaffoldRegistryEntry[]): string {
  return sha256(stableJson(entries))
}

export function computeScaffoldOptionsDigest(
  kind: ScaffoldKind,
  options: Readonly<Record<string, unknown>> = {},
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
  options: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
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
    if (keys.length === 1 && options.exposure === 'contract-only')
      return { exposure: 'contract-only' }
    return apiV3OptionsSchema.parse(options)
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
