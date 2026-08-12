import { z } from 'zod'
import { capabilitySchema, type Capability } from './composition/catalog.js'
import { resolveCapabilities } from './composition/resolver.js'

export const profileSchema = z.enum(['minimal', 'standard', 'production', 'regulated'])
export { capabilitySchema }

const providerNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9.-]{1,63}$/, 'Provider must be a public identifier')

const uniqueCapabilityArraySchema = z
  .array(capabilitySchema)
  .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
    message: 'Duplicate capability selection',
  })

export const projectManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    profile: profileSchema.default('standard'),
    capabilities: uniqueCapabilityArraySchema.default([]),
    license: z.enum(['ISC', 'MIT', 'UNLICENSED']).optional(),
    providers: z
      .object({
        hosting: providerNameSchema.optional(),
        registry: providerNameSchema.optional(),
        secretStore: providerNameSchema.optional(),
        backup: providerNameSchema.optional(),
        mail: providerNameSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()

export type ProjectManifest = z.infer<typeof projectManifestSchema>
export type ResolvedManifest = Omit<ProjectManifest, 'capabilities'> & {
  capabilities: Capability[]
}

export const resolvedManifestSchema = projectManifestSchema.extend({
  capabilities: uniqueCapabilityArraySchema,
})

const lockedResolvedManifestSchema = resolvedManifestSchema.required({
  profile: true,
  capabilities: true,
  providers: true,
})

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const projectLockV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    generatorVersion: z.literal('0.1.0'),
    templateVersion: z.literal('0.1.0'),
    userManifestDigest: digestSchema,
    resolved: lockedResolvedManifestSchema,
    compatibility: z
      .object({
        node: z.literal('>=22.20.0 <25'),
        pnpm: z.literal('11.20.0'),
      })
      .strict(),
    fragments: z.array(z.object({ id: z.string().min(1), checksum: digestSchema }).strict()),
    integrity: digestSchema,
  })
  .strict()

const boundedCompatibilitySchema = z.string().min(1).max(128)
const releaseBaselineSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
const componentIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/)
const componentVersionSchema = z.number().int().positive()

const outputPathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((path, context) => {
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.endsWith('/') ||
      path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Output path must be a normalized POSIX relative path',
      })
    }
  })

export const projectLockV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    generatorVersion: releaseBaselineSchema,
    templateVersion: releaseBaselineSchema,
    userManifestDigest: digestSchema,
    resolved: lockedResolvedManifestSchema,
    compatibility: z
      .object({
        node: boundedCompatibilitySchema,
        pnpm: boundedCompatibilitySchema,
        typescript: boundedCompatibilitySchema,
      })
      .strict(),
    baselines: z
      .object({
        manifest: z.literal(1),
        database: releaseBaselineSchema,
        openapi: releaseBaselineSchema,
      })
      .strict(),
    fragments: z.array(
      z
        .object({
          id: componentIdSchema,
          version: componentVersionSchema,
          checksum: digestSchema,
        })
        .strict(),
    ),
    composers: z.array(
      z
        .object({
          id: componentIdSchema,
          version: componentVersionSchema,
          checksum: digestSchema,
        })
        .strict(),
    ),
    outputs: z.array(
      z
        .object({
          path: outputPathSchema,
          owner: componentIdSchema,
          checksum: digestSchema,
          mode: z.number().int().min(0).max(0o777),
        })
        .strict(),
    ),
    certification: z
      .object({
        profile: profileSchema,
        matrix: releaseBaselineSchema,
        status: z.enum(['certified', 'supported', 'experimental']),
      })
      .strict(),
    integrity: digestSchema,
  })
  .strict()
  .superRefine((lock, context) => {
    const fragmentIds = new Set<string>()
    lock.fragments.forEach((fragment, index) => {
      if (fragmentIds.has(fragment.id)) {
        context.addIssue({
          code: 'custom',
          path: ['fragments', index, 'id'],
          message: 'Duplicate fragment id',
        })
      }
      fragmentIds.add(fragment.id)
    })

    const composerIds = new Set<string>()
    lock.composers.forEach((composer, index) => {
      if (composerIds.has(composer.id)) {
        context.addIssue({
          code: 'custom',
          path: ['composers', index, 'id'],
          message: 'Duplicate composer id',
        })
      }
      composerIds.add(composer.id)
    })

    const owners = new Set([...fragmentIds, ...composerIds])
    const paths = new Set<string>()
    lock.outputs.forEach((output, index) => {
      if (output.path !== output.path.normalize('NFC')) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'path'],
          message: 'Output path must use NFC normalization',
        })
      }
      const canonicalPath = output.path
        .normalize('NFC')
        .toUpperCase()
        .toLowerCase()
        .normalize('NFC')
      if (paths.has(canonicalPath)) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'path'],
          message: 'Duplicate output path',
        })
      }
      paths.add(canonicalPath)
      if (!owners.has(output.owner)) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'owner'],
          message: 'Output owner must reference a fragment or composer',
        })
      }
    })

    if (lock.certification.profile !== lock.resolved.profile) {
      context.addIssue({
        code: 'custom',
        path: ['certification', 'profile'],
        message: 'Certification profile must match the resolved profile',
      })
    }
  })

export const projectLockSchema = z.discriminatedUnion('schemaVersion', [
  projectLockV1Schema,
  projectLockV2Schema,
])

export type ProjectLockV1Data = z.infer<typeof projectLockV1Schema>
export type ProjectLockV2Data = z.infer<typeof projectLockV2Schema>
export type ProjectLockData = z.infer<typeof projectLockSchema>

const profileCapabilities: Record<ProjectManifest['profile'], readonly Capability[]> = {
  minimal: [],
  standard: ['web', 'api', 'ui', 'database', 'auth'],
  production: ['web', 'api', 'ui', 'database', 'auth', 'observability'],
  regulated: ['web', 'api', 'ui', 'database', 'auth', 'observability', 'privacy'],
}

const productionProviders = ['hosting', 'registry', 'secretStore', 'backup', 'mail'] as const

export function resolveManifest(input: unknown): ResolvedManifest {
  const manifest = projectManifestSchema.parse(input)
  const selected = [...profileCapabilities[manifest.profile], ...manifest.capabilities]
  const capabilities = resolveCapabilities([...new Set(selected)], {
    allowExperimental: manifest.profile === 'production' || manifest.profile === 'regulated',
  })

  if (
    (manifest.profile === 'production' || manifest.profile === 'regulated') &&
    productionProviders.some((key) => !manifest.providers[key])
  ) {
    throw new Error(
      'production and regulated profiles require hosting, registry, secretStore, backup and mail providers',
    )
  }

  return { ...manifest, capabilities }
}
