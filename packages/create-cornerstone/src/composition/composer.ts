import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { stableJson } from '../hash.js'
import type { ResolvedManifest } from '../schema.js'
import type { CanonicalTemplateMetadata, ComposerDefinition } from './template.js'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
const jsonPrintWidth = 100

export interface JsonContribution {
  owner: string
  value: { [key: string]: JsonValue }
}

export interface ComposedOutput {
  owner: string
  path: string
  content: Uint8Array
}

export function mergeJsonContributions(contributions: readonly JsonContribution[]): {
  [key: string]: JsonValue
} {
  const output: { [key: string]: JsonValue } = {}
  const owners = new Map<string, string>()
  for (const contribution of contributions) {
    assertSafeContributionValue(contribution.value, contribution.owner)
    mergeObject(output, contribution.value, contribution.owner, '', owners)
  }
  return output
}

export async function composeStructuredOutputs(
  templateRoot: string,
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): Promise<ComposedOutput[]> {
  const outputs: ComposedOutput[] = []
  for (const composer of metadata.composers) {
    const content = await composeOne(templateRoot, metadata, composer, manifest)
    if (content !== undefined) outputs.push({ owner: composer.id, path: composer.output, content })
  }
  return outputs.sort((left, right) => left.path.localeCompare(right.path))
}

export function composePredecessorReadme(manifest: ResolvedManifest, matrix: string): Uint8Array {
  return Buffer.from(
    `# ${manifest.name}\n\n` +
      `Generated from the Cornerstone **${manifest.profile} preview** composition.\n\n` +
      `Support matrix: \`${matrix}\` (supported preview; not certified for production).\n\n` +
      'The `production` and `regulated` profiles remain unavailable until their certification gates pass.\n\n' +
      'Security warning: values in `.env.example`, including fixed secrets and database credentials, are local-development fixtures only. Before production or any external deployment, replace them with independent secrets and credentials and pass validation with `NODE_ENV=production`.\n\n' +
      '`create-cornerstone verify` checks manifest resolution and composer-owned shared outputs. It does not require user-owned fragment source to remain byte-identical to the template or authenticate the entire project against tampering. Lock `integrity` is a self-consistency digest; release authenticity depends on package provenance and the M9 distribution-trust gate.\n',
  )
}

async function composeOne(
  templateRoot: string,
  metadata: CanonicalTemplateMetadata,
  composer: ComposerDefinition,
  manifest: ResolvedManifest,
): Promise<Uint8Array | undefined> {
  if (composer.format === 'license') {
    if (!manifest.license || manifest.license === 'UNLICENSED') return undefined
    return readFile(join(templateRoot, 'licenses', manifest.license))
  }

  if (composer.format === 'notice') {
    const notices = new Set<string>()
    notices.add((await readFile(join(import.meta.dirname, '..', '..', 'NOTICE'), 'utf8')).trim())
    for (const capability of ['base', ...manifest.capabilities].sort()) {
      await collectNotices(join(templateRoot, 'fragments', capability), notices)
    }
    const model = mergeJsonContributions([
      { owner: 'attributions', value: { notices: [...notices].filter(Boolean).sort() } },
    ])
    return Buffer.from(`${(model.notices as string[]).join('\n\n---\n\n')}\n`)
  }

  if (composer.format === 'readme') {
    const model = mergeJsonContributions([
      {
        owner: 'profile',
        value: {
          title: manifest.name,
          profile: manifest.profile,
          matrix: metadata.profiles.standard.certification.matrix,
        },
      },
    ])
    return Buffer.from(
      `# ${model.title as string}\n\n` +
        `Generated from the Cornerstone **${model.profile as string} preview** composition.\n\n` +
        `Support matrix: \`${model.matrix as string}\` (supported preview; not certified for production).\n\n` +
        'The `production` and `regulated` profiles remain unavailable until their certification gates pass.\n\n' +
        'Security warning: values in `.env.example`, including fixed secrets and database credentials, are local-development fixtures only. Before production or any external deployment, replace them with independent secrets and credentials and pass validation with `NODE_ENV=production`.\n\n' +
        '`create-cornerstone verify` checks manifest resolution and composer-owned shared outputs. It does not require user-owned fragment source to remain byte-identical to the template or authenticate the entire project against tampering. Lock `integrity` is a self-consistency digest; release authenticity depends on package provenance and the M9 distribution-trust gate.\n' +
        '\nUse `create-cornerstone plan <target> --dry-run` before `create-cornerstone update <target>`; interrupted journaled updates are recovered on the next lifecycle command.\n',
    )
  }

  if (composer.format === 'nest-module') {
    if (!composer.nestModule) throw new Error(`Composer ${composer.id} is missing nestModule`)
    return Buffer.from(composeNestModule(composer.nestModule))
  }

  const source = await readComposerSource(templateRoot, composer)
  if (composer.format === 'package-json') {
    const value = parseJsonObject(source)
    delete value.name
    delete value.license
    const scripts = objectValue(value.scripts, 'package.json scripts')
    delete scripts['generator:verify']
    delete scripts['generator:standard:candidate']
    delete scripts['generator:standard:database']
    delete scripts['generator:portability:compare']
    const composed = mergeJsonContributions([
      { owner: 'workspace-snapshot', value },
      {
        owner: 'project-manifest',
        value: {
          name: manifest.name,
          ...(manifest.license ? { license: manifest.license } : {}),
        },
      },
    ])
    return Buffer.from(formatJsonDocument(composed))
  }

  if (composer.format === 'json') {
    const composed = mergeJsonContributions([
      { owner: 'workspace-snapshot', value: parseJsonObject(source) },
    ])
    return Buffer.from(formatJsonDocument(composed))
  }

  if (composer.format === 'test-scope') {
    const value = parseJsonObject(source)
    for (const task of Object.values(value)) {
      const scope = objectValue(task, 'test scope')
      if (Array.isArray(scope.participants)) {
        scope.participants = scope.participants.filter(
          (participant) => participant !== 'create-cornerstone',
        )
      }
      const exclusions = objectValue(scope.excluded, 'test scope exclusions')
      delete exclusions['create-cornerstone']
    }
    const composed = mergeJsonContributions([{ owner: 'workspace-snapshot', value }])
    return Buffer.from(formatJsonDocument(composed))
  }

  const yaml = parse(source) as unknown
  if (!yaml || typeof yaml !== 'object' || Array.isArray(yaml)) {
    throw new Error(`${composer.id} source must contain a YAML object`)
  }
  const value = yaml as { [key: string]: JsonValue }
  if (composer.format === 'ci-workflow') removeUnsupportedCiSteps(value)
  const composed = mergeJsonContributions([{ owner: 'workspace-snapshot', value }])
  return Buffer.from(stringify(composed, { sortMapEntries: true, singleQuote: true }))
}

export function composeNestModule(module: NonNullable<ComposerDefinition['nestModule']>): string {
  const lines = module.imports.map(({ names, from }) => {
    return `import { ${names.join(', ')} } from '${from}';`
  })
  const fields: string[] = []
  if (module.moduleImports.length > 0) {
    const values = module.moduleImports.map((value) => renderNestModuleImport(value))
    const simple = values.every((value) => !value.includes('\n'))
    fields.push(
      simple
        ? `  imports: [${values.join(', ')}],`
        : `  imports: [\n${values.map((value) => indentExpression(value, 4)).join(',\n')},\n  ],`,
    )
  }
  if (module.controllers.length > 0) {
    const inline = `  controllers: [${module.controllers.join(', ')}],`
    fields.push(
      module.controllers.length <= 2 && inline.length <= jsonPrintWidth
        ? inline
        : `  controllers: [\n${module.controllers.map((value) => `    ${value},`).join('\n')}\n  ],`,
    )
  }
  if (module.providers.length > 0) {
    fields.push(
      `  providers: [\n${module.providers
        .map(({ provide, useClass }) => `    { provide: ${provide}, useClass: ${useClass} }`)
        .join(',\n')},\n  ],`,
    )
  }
  return `${lines.join('\n')}\n\n@Module({\n${fields.join('\n')}\n})\nexport class ${module.className} {}\n`
}

function renderNestModuleImport(
  value: NonNullable<ComposerDefinition['nestModule']>['moduleImports'][number],
): string {
  if (value.kind === 'identifier') return value.name
  return (
    `${value.module}.forRoot({\n` +
    `  isGlobal: ${value.isGlobal},\n` +
    `  cache: ${value.cache},\n` +
    `  load: [${value.load}],\n` +
    `  validate: ${value.validate},\n` +
    '})'
  )
}

function indentExpression(value: string, spaces: number): string {
  const padding = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n')
}

export function formatJsonDocument(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('JSON document must contain a serializable value')
  const normalized: unknown = JSON.parse(serialized)
  if (!isJsonValue(normalized)) throw new Error('JSON document contains an unsupported value')
  return `${formatJsonValue(normalized, 0, 0)}\n`
}

async function readComposerSource(
  templateRoot: string,
  composer: ComposerDefinition,
): Promise<string> {
  if (!composer.source) throw new Error(`Composer ${composer.id} has no source`)
  return readFile(join(templateRoot, 'composer-sources', composer.id), 'utf8')
}

function parseJsonObject(source: string): { [key: string]: JsonValue } {
  const value = JSON.parse(source) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Composer JSON source must contain an object')
  }
  return value as { [key: string]: JsonValue }
}

function objectValue(value: JsonValue | undefined, label: string): { [key: string]: JsonValue } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function mergeObject(
  target: { [key: string]: JsonValue },
  source: { [key: string]: JsonValue },
  owner: string,
  prefix: string,
  owners: Map<string, string>,
): void {
  for (const [key, incoming] of Object.entries(source).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const path = prefix ? `${prefix}.${key}` : key
    const current = target[key]
    if (current === undefined) {
      target[key] = structuredClone(incoming)
      markLeaves(incoming, owner, path, owners)
      continue
    }
    if (isObject(current) && isObject(incoming)) {
      mergeObject(current, incoming, owner, path, owners)
      continue
    }
    if (stableJson(current) !== stableJson(incoming)) {
      throw new Error(
        `Structured composer conflict at ${path}: ${owners.get(path) ?? 'unknown'} and ${owner}`,
      )
    }
  }
}

function markLeaves(
  value: JsonValue,
  owner: string,
  path: string,
  owners: Map<string, string>,
): void {
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value))
      markLeaves(child, owner, `${path}.${key}`, owners)
  } else {
    owners.set(path, owner)
  }
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

function assertSafeContributionValue(value: JsonValue, owner: string, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeContributionValue(item, owner, `${path}[${index}]`))
    return
  }
  if (!isObject(value)) return
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `Structured composer ${owner} contains an unsafe object prototype at ${path || '<root>'}`,
    )
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error(`Structured composer ${owner} contains forbidden key ${childPath}`)
    }
    assertSafeContributionValue(child, owner, childPath)
  }
}

function formatJsonValue(value: JsonValue, indentation: number, column: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((item) => !Array.isArray(item) && !isObject(item))) {
      const compact = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`
      if (column + compact.length <= jsonPrintWidth) return compact
    }
    const childIndentation = indentation + 2
    const padding = ' '.repeat(childIndentation)
    return `[\n${value
      .map((item) => `${padding}${formatJsonValue(item, childIndentation, childIndentation)}`)
      .join(',\n')}\n${' '.repeat(indentation)}]`
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const childIndentation = indentation + 2
    const padding = ' '.repeat(childIndentation)
    return `{\n${entries
      .map(([key, item]) => {
        const prefix = `${padding}${JSON.stringify(key)}: `
        return `${prefix}${formatJsonValue(item, childIndentation, prefix.length)}`
      })
      .join(',\n')}\n${' '.repeat(indentation)}}`
  }
  return JSON.stringify(value)
}

async function collectNotices(directory: string, notices: Set<string>): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collectNotices(path, notices)
    else if (entry.isFile() && entry.name === 'NOTICE')
      notices.add((await readFile(path, 'utf8')).trim())
  }
}

function removeUnsupportedCiSteps(workflow: { [key: string]: JsonValue }): void {
  const jobs = objectValue(workflow.jobs, 'CI jobs')
  delete jobs['standard-candidate']
  delete jobs['generator-portability']
  delete jobs['generator-portability-compare']
  const unsupported = new Set([
    'pnpm generator:verify',
    'pnpm generator:standard:candidate',
    'pnpm generator:portability:compare',
  ])
  for (const job of Object.values(jobs)) {
    const jobObject = objectValue(job, 'CI job')
    if (!Array.isArray(jobObject.steps)) continue
    jobObject.steps = jobObject.steps.filter((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return true
      return !unsupported.has(step.run as string)
    })
  }
}
