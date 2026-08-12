import { z } from 'zod'

export const profileSchema = z.enum(['minimal', 'standard', 'production', 'regulated'])
export const capabilitySchema = z.enum([
  'web',
  'api',
  'ui',
  'database',
  'auth',
  'observability',
  'privacy',
])

const providerNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9.-]{1,63}$/, 'Provider must be a public identifier')

export const projectManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    profile: profileSchema.default('standard'),
    capabilities: z.array(capabilitySchema).default([]),
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
  capabilities: z.infer<typeof capabilitySchema>[]
}

export const resolvedManifestSchema = projectManifestSchema.extend({
  capabilities: z.array(capabilitySchema),
})

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const projectLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorVersion: z.literal('0.1.0'),
    templateVersion: z.literal('0.1.0'),
    userManifestDigest: digestSchema,
    resolved: resolvedManifestSchema,
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

export type ProjectLockData = z.infer<typeof projectLockSchema>

const profileCapabilities: Record<
  ProjectManifest['profile'],
  readonly z.infer<typeof capabilitySchema>[]
> = {
  minimal: [],
  standard: ['web', 'api', 'ui', 'database', 'auth'],
  production: ['web', 'api', 'ui', 'database', 'auth', 'observability'],
  regulated: ['web', 'api', 'ui', 'database', 'auth', 'observability', 'privacy'],
}

const productionProviders = ['hosting', 'registry', 'secretStore', 'backup', 'mail'] as const

export function resolveManifest(input: unknown): ResolvedManifest {
  const manifest = projectManifestSchema.parse(input)
  const capabilities = [
    ...new Set([...profileCapabilities[manifest.profile], ...manifest.capabilities]),
  ].sort()

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
