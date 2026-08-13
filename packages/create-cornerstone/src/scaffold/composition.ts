import {
  composeNestModule,
  composeStructuredOutputs,
  type ComposedOutput,
} from '../composition/composer.js'
import type { CanonicalTemplateMetadata, ComposerDefinition } from '../composition/template.js'
import type { ResolvedManifest } from '../schema.js'
import { validateScaffoldRegistry, type ScaffoldRegistryEntry } from './registry.js'
import { pascalCase } from './render.js'

const appModuleOwner = 'api-app-module'
const contractModuleOwner = 'api-contract-module'
const routePolicyPath = 'apps/api/src/authorization/route-policy.ts'

export async function composeScaffoldAwareOutputs(
  templateRoot: string,
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
  scaffolds: readonly ScaffoldRegistryEntry[],
): Promise<ComposedOutput[]> {
  const validated = validateScaffoldRegistry(scaffolds)
  const outputs = await composeStructuredOutputs(templateRoot, metadata, manifest)
  if (validated.length === 0) return outputs
  const appContributions = validated.filter(isAppModuleContribution)
  const apiV3 = validated.filter((entry) => entry.kind === 'api' && entry.version === 3)
  return outputs.map((output) => {
    if (output.owner === appModuleOwner && (appContributions.length > 0 || apiV3.length > 0)) {
      const definition = metadata.composers.find(({ id }) => id === output.owner)
      if (!definition?.nestModule) throw new Error(`Missing Nest module composer: ${output.owner}`)
      return {
        ...output,
        content: Buffer.from(
          composeNestModule(
            composeApiDefinition(
              composeAppModule(definition.nestModule, appContributions),
              apiV3,
              'runtime',
            ),
          ),
        ),
      }
    }
    if (output.owner === contractModuleOwner && apiV3.length > 0)
      return composeApiModule(output, metadata, apiV3, 'contract')
    if (output.path === routePolicyPath && apiV3.length > 0)
      return {
        ...output,
        content: Buffer.from(
          composeRoutePolicies(Buffer.from(output.content).toString('utf8'), apiV3),
        ),
      }
    return output
  })
}

function isAppModuleContribution(entry: ScaffoldRegistryEntry): boolean {
  return entry.kind === 'feature' && entry.version === 2
}

function composeAppModule(
  base: NonNullable<ComposerDefinition['nestModule']>,
  scaffolds: readonly ScaffoldRegistryEntry[],
): NonNullable<ComposerDefinition['nestModule']> {
  const modules = scaffolds
  return {
    ...base,
    imports: [
      ...base.imports,
      ...modules.map(({ name }) => ({
        names: [`${pascalCase(name)}Module`],
        from: `./${name}/${name}.module.js`,
      })),
    ].sort((left, right) => compareImports(left.from, right.from)),
    moduleImports: [
      ...base.moduleImports,
      ...modules.map(({ name }) => ({
        kind: 'identifier' as const,
        name: `${pascalCase(name)}Module`,
      })),
    ].sort((left, right) => renderReference(left).localeCompare(renderReference(right))),
  }
}

function composeApiModule(
  output: ComposedOutput,
  metadata: CanonicalTemplateMetadata,
  scaffolds: readonly ScaffoldRegistryEntry[],
  mode: 'runtime' | 'contract',
): ComposedOutput {
  const definition = metadata.composers.find(({ id }) => id === output.owner)
  if (!definition?.nestModule) throw new Error(`Missing Nest module composer: ${output.owner}`)
  return {
    ...output,
    content: Buffer.from(
      composeNestModule(composeApiDefinition(definition.nestModule, scaffolds, mode)),
    ),
  }
}

function composeApiDefinition(
  base: NonNullable<ComposerDefinition['nestModule']>,
  scaffolds: readonly ScaffoldRegistryEntry[],
  mode: 'runtime' | 'contract',
): NonNullable<ComposerDefinition['nestModule']> {
  const imports = scaffolds.map(({ name }) =>
    mode === 'runtime'
      ? { names: [`${pascalCase(name)}Module`], from: `./${name}/${name}.module.js` }
      : {
          names: [`${pascalCase(name)}ContractController`],
          from: `./${name}-contract.controller.js`,
        },
  )
  const moduleImports =
    mode === 'runtime'
      ? imports.map(({ names }) => ({ kind: 'identifier' as const, name: names[0]! }))
      : []
  const controllers =
    mode === 'contract' ? scaffolds.map(({ name }) => `${pascalCase(name)}ContractController`) : []
  // Contract modules deliberately have no generated provider/runtime module registration.
  return {
    ...base,
    imports: [...base.imports, ...imports].sort((a, b) => compareImports(a.from, b.from)),
    moduleImports: [...base.moduleImports, ...moduleImports].sort((a, b) =>
      renderReference(a).localeCompare(renderReference(b)),
    ),
    controllers: [...base.controllers, ...controllers].sort(),
  }
}

function composeRoutePolicies(source: string, scaffolds: readonly ScaffoldRegistryEntry[]): string {
  const marker = 'const scaffoldRoutePolicies: readonly RoutePolicy[] = [];'
  if (!source.includes(marker))
    throw new Error('Route policy scaffold composition marker is missing')
  const entries = [...scaffolds]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => {
      if (entry.kind !== 'api' || entry.version !== 3)
        throw new Error(`Invalid API v3 route policy contribution: ${entry.id}`)
      const value = entry.options
      return `  {
    method: '${value.method}',
    path: '/api/v1${value.path}',
    operationId: '${value.operationId}',
    authentication: '${value.authentication}',
    csrf: ${value.csrf},
    roles: [${value.roles.map((role) => `'${role}'`).join(', ')}],${
      value.permission
        ? `
    permission: '${value.permission}',`
        : ''
    }
    ownership: 'none',
    owner: 'backend',
    reason: 'Generated API scaffold ${value.operationId}.',
  },`
    })
  return source.replace(
    marker,
    `const scaffoldRoutePolicies: readonly RoutePolicy[] = [\n${entries.join('\n')}\n];`,
  )
}

function compareImports(left: string, right: string): number {
  const leftPackage = !left.startsWith('.')
  const rightPackage = !right.startsWith('.')
  if (leftPackage !== rightPackage) return leftPackage ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function renderReference(
  value: NonNullable<ComposerDefinition['nestModule']>['moduleImports'][number],
): string {
  return value.kind === 'identifier' ? value.name : value.module
}
