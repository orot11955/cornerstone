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
  return outputs.map((output) => {
    if (output.owner !== appModuleOwner || appContributions.length === 0) return output
    const definition = metadata.composers.find(({ id }) => id === output.owner)
    if (!definition?.nestModule) throw new Error(`Missing Nest module composer: ${output.owner}`)
    return {
      ...output,
      content: Buffer.from(
        composeNestModule(composeAppModule(definition.nestModule, appContributions)),
      ),
    }
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
