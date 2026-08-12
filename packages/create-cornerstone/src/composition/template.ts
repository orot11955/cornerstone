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
  'json',
  'yaml',
  'test-scope',
  'ci-workflow',
  'readme',
  'notice',
  'license',
])

export const composerDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    version: z.number().int().positive(),
    format: composerFormatSchema,
    output: relativePathSchema,
    source: relativePathSchema.optional(),
  })
  .strict()
  .superRefine((composer, context) => {
    const needsSource = !['readme', 'notice', 'license'].includes(composer.format)
    if (needsSource !== Boolean(composer.source)) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: needsSource
          ? `${composer.format} composer requires a source`
          : `${composer.format} composer must not declare a source`,
      })
    }
  })

export const canonicalTemplateMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
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
    composers: z.array(composerDefinitionSchema),
  })
  .strict()
  .superRefine((metadata, context) => {
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
