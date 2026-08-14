import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { capabilitySchema } from './catalog.js'

const relativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((path, context) => {
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.includes(':') ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.endsWith('/') ||
      path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Path must be a normalized literal POSIX relative path without pathspec magic',
      })
    }
  })

const fragmentIdSchema = z.union([z.literal('base'), capabilitySchema])

const fragmentSchema = z
  .object({
    id: fragmentIdSchema,
    version: z.number().int().positive(),
    mappings: z.array(
      z
        .object({
          source: relativePathSchema,
          exclude: z.array(relativePathSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict()

export const composerFormatSchema = z.enum([
  'package-json',
  'pnpm-lock',
  'json',
  'yaml',
  'test-scope',
  'ci-workflow',
  'readme',
  'notice',
  'license',
  'nest-module',
  'typescript-source',
])

const nestImportSchema = z
  .object({
    names: z.array(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)).min(1),
    from: z.string().regex(/^(?:@?[a-z0-9][a-z0-9._/-]*|\.\.?\/[a-z0-9._/-]+\.js)$/),
  })
  .strict()

const nestIdentifierSchema = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
const nestModuleImportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identifier'), name: nestIdentifierSchema }).strict(),
  z
    .object({
      kind: z.literal('config-for-root'),
      module: nestIdentifierSchema,
      load: nestIdentifierSchema,
      validate: nestIdentifierSchema,
      isGlobal: z.boolean(),
      cache: z.boolean(),
    })
    .strict(),
])
const nestProviderSchema = z
  .object({ provide: nestIdentifierSchema, useClass: nestIdentifierSchema })
  .strict()

const nestModuleSchema = z
  .object({
    imports: z.array(nestImportSchema),
    moduleImports: z.array(nestModuleImportSchema),
    controllers: z.array(nestIdentifierSchema),
    providers: z.array(nestProviderSchema),
    className: z.string().regex(/^[A-Z][A-Za-z0-9]*Module$/),
  })
  .strict()
  .superRefine((module, context) => {
    assertUnique(
      module.imports.map(({ from }) => from),
      'Nest import source',
      context,
      ['imports'],
    )
    assertUnique(
      module.imports.flatMap(({ names }) => names),
      'Nest import identifier',
      context,
      ['imports'],
    )
    assertUnique(module.controllers, 'Nest controller', context, ['controllers'])
    assertUnique(
      module.providers.map(({ provide }) => provide),
      'Nest provider token',
      context,
      ['providers'],
    )
    const imported = new Set(module.imports.flatMap(({ names }) => names))
    const referenced = [
      module.className === 'AppModule' ? 'Module' : 'Module',
      ...module.controllers,
      ...module.providers.flatMap(({ provide, useClass }) => [provide, useClass]),
      ...module.moduleImports.flatMap((entry) =>
        entry.kind === 'identifier' ? [entry.name] : [entry.module, entry.load, entry.validate],
      ),
    ]
    for (const identifier of referenced) {
      if (!imported.has(identifier)) {
        context.addIssue({
          code: 'custom',
          message: `Nest module references an identifier that is not imported: ${identifier}`,
        })
      }
    }
  })

export const composerDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    version: z.number().int().positive(),
    format: composerFormatSchema,
    output: relativePathSchema,
    source: relativePathSchema.optional(),
    nestModule: nestModuleSchema.optional(),
  })
  .strict()
  .superRefine((composer, context) => {
    const needsSource = !['readme', 'notice', 'license', 'nest-module'].includes(composer.format)
    if (needsSource !== Boolean(composer.source)) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: needsSource
          ? `${composer.format} composer requires a source`
          : `${composer.format} composer must not declare a source`,
      })
    }
    if ((composer.format === 'nest-module') !== Boolean(composer.nestModule)) {
      context.addIssue({
        code: 'custom',
        path: ['nestModule'],
        message: 'nest-module composer requires exactly one structured module definition',
      })
    }
    if (composer.format === 'typescript-source' && composer.source !== composer.output) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'typescript-source composer requires an exact source/output path match',
      })
    }
  })

export const canonicalTemplateMetadataSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    profiles: z
      .object({
        standard: z
          .object({
            capabilities: z.array(capabilitySchema).length(5),
            certification: z
              .object({
                matrix: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
                status: z.literal('supported'),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    fragments: z.array(fragmentSchema),
    examples: z
      .object({
        referenceApp: fragmentSchema.extend({ id: z.literal('example-reference-app') }),
      })
      .strict()
      .optional(),
    composers: z.array(composerDefinitionSchema),
  })
  .strict()
  .superRefine((metadata, context) => {
    if ((metadata.schemaVersion === 2) !== Boolean(metadata.examples)) {
      context.addIssue({
        code: 'custom',
        path: ['examples'],
        message: 'Template schemaVersion 2 requires the reference app example contract',
      })
    }
    assertUnique(
      metadata.fragments.map(({ id }) => id),
      'fragment',
      context,
      ['fragments'],
    )
    assertUnique(
      metadata.composers.map(({ id }) => id),
      'composer',
      context,
      ['composers'],
    )
    assertUnique(
      metadata.composers.map(({ output }) => canonicalPath(output)),
      'composer output',
      context,
      ['composers'],
    )

    const fragmentIds = new Set(metadata.fragments.map(({ id }) => id))
    for (const id of ['base', ...capabilitySchema.options]) {
      if (!fragmentIds.has(id as 'base')) {
        context.addIssue({
          code: 'custom',
          path: ['fragments'],
          message: `Missing fragment: ${id}`,
        })
      }
    }

    const exactStandard = ['api', 'auth', 'database', 'ui', 'web']
    if (
      JSON.stringify([...metadata.profiles.standard.capabilities].sort()) !==
      JSON.stringify(exactStandard)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profiles', 'standard', 'capabilities'],
        message: 'Standard profile must contain the exact supported capability set',
      })
    }
  })

export type CanonicalTemplateMetadata = z.infer<typeof canonicalTemplateMetadataSchema>
export type ComposerDefinition = z.infer<typeof composerDefinitionSchema>

let cachedMetadata: CanonicalTemplateMetadata | undefined

export function loadCanonicalTemplateMetadata(): CanonicalTemplateMetadata {
  cachedMetadata ??= canonicalTemplateMetadataSchema.parse(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', 'templates', 'canonical', 'standard.json'),
        'utf8',
      ),
    ),
  )
  return cachedMetadata
}

export function validateCanonicalOwnership(
  fragmentFiles: Readonly<Record<string, readonly string[]>>,
  composers: readonly Pick<ComposerDefinition, 'id' | 'output'>[],
): void {
  const owners = new Map<string, string>()
  for (const [fragment, paths] of Object.entries(fragmentFiles).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const path of [...paths].sort()) {
      const key = canonicalPath(relativePathSchema.parse(path))
      const previous = owners.get(key)
      if (previous)
        throw new Error(`Output ownership conflict for ${path}: ${previous} and ${fragment}`)
      owners.set(key, fragment)
    }
  }
  for (const composer of composers) {
    const path = relativePathSchema.parse(composer.output)
    const key = canonicalPath(path)
    const previous = owners.get(key)
    if (previous) {
      throw new Error(
        `Composer-owned path ${path} must not be included in fragment payload ${previous}`,
      )
    }
    owners.set(key, composer.id)
  }
}

function canonicalPath(path: string): string {
  return path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')
}

function assertUnique(
  values: readonly string[],
  label: string,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: `Duplicate ${label}` })
  }
}
