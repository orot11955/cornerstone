import { z } from 'zod'

export const capabilitySchema = z.enum([
  'web',
  'api',
  'ui',
  'database',
  'auth',
  'observability',
  'privacy',
])

export type Capability = z.infer<typeof capabilitySchema>

export const capabilitySupportSchema = z.enum(['supported', 'experimental'])

const uniqueCapabilities = (values: readonly Capability[]): boolean =>
  new Set(values).size === values.length

export const capabilityMetadataSchema = z
  .object({
    id: capabilitySchema,
    version: z.number().int().positive(),
    dependencies: z.array(capabilitySchema),
    conflicts: z.array(capabilitySchema),
    support: capabilitySupportSchema,
  })
  .strict()
  .superRefine((metadata, context) => {
    if (!uniqueCapabilities(metadata.dependencies)) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: 'Duplicate dependency' })
    }
    if (!uniqueCapabilities(metadata.conflicts)) {
      context.addIssue({ code: 'custom', path: ['conflicts'], message: 'Duplicate conflict' })
    }
    if (metadata.dependencies.includes(metadata.id)) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: 'Self-dependency' })
    }
    if (metadata.conflicts.includes(metadata.id)) {
      context.addIssue({ code: 'custom', path: ['conflicts'], message: 'Self-conflict' })
    }
  })

export type CapabilityMetadata = z.infer<typeof capabilityMetadataSchema>

export const capabilityCatalogSchema = z
  .array(capabilityMetadataSchema)
  .length(capabilitySchema.options.length)
  .superRefine((catalog, context) => {
    const ids = catalog.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate capability metadata' })
    }
    for (const id of capabilitySchema.options) {
      if (!ids.includes(id)) {
        context.addIssue({ code: 'custom', message: `Missing capability metadata: ${id}` })
      }
    }
  })

export type CapabilityCatalog = z.infer<typeof capabilityCatalogSchema>

export const bundledCapabilityCatalog = capabilityCatalogSchema.parse([
  { id: 'ui', version: 1, dependencies: [], conflicts: [], support: 'supported' },
  { id: 'web', version: 1, dependencies: ['ui'], conflicts: [], support: 'supported' },
  { id: 'api', version: 1, dependencies: [], conflicts: [], support: 'supported' },
  {
    id: 'database',
    version: 1,
    dependencies: ['api'],
    conflicts: [],
    support: 'supported',
  },
  {
    id: 'auth',
    version: 1,
    dependencies: ['api', 'database'],
    conflicts: [],
    support: 'supported',
  },
  {
    id: 'observability',
    version: 1,
    dependencies: [],
    conflicts: [],
    support: 'experimental',
  },
  {
    id: 'privacy',
    version: 1,
    dependencies: ['auth', 'database', 'observability'],
    conflicts: [],
    support: 'experimental',
  },
])
