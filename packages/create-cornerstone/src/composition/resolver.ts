import {
  bundledCapabilityCatalog,
  capabilityCatalogSchema,
  capabilitySchema,
  type Capability,
  type CapabilityCatalog,
  type CapabilityMetadata,
} from './catalog.js'

export interface CapabilityResolutionOptions {
  allowExperimental?: boolean
  catalog?: unknown
}

function catalogIndex(input: unknown): Map<Capability, CapabilityMetadata> {
  const catalog = capabilityCatalogSchema.parse(input)
  const index = new Map(catalog.map((metadata) => [metadata.id, metadata]))
  assertAcyclicCatalog(index)
  return index
}

function assertAcyclicCatalog(index: ReadonlyMap<Capability, CapabilityMetadata>): void {
  const visiting = new Set<Capability>()
  const visited = new Set<Capability>()

  const visit = (id: Capability): void => {
    if (visiting.has(id)) throw new Error(`Capability dependency cycle detected at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    const metadata = index.get(id)
    if (!metadata) throw new Error(`Unknown capability metadata: ${id}`)
    for (const dependency of [...metadata.dependencies].sort()) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of [...index.keys()].sort()) visit(id)
}

function parseUniqueCapabilities(input: unknown): Capability[] {
  const capabilities = capabilitySchema.array().parse(input)
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error('Duplicate capability selection')
  }
  return capabilities
}

function dependencyClosure(
  selected: readonly Capability[],
  index: ReadonlyMap<Capability, CapabilityMetadata>,
): Set<Capability> {
  const resolved = new Set<Capability>()
  const visit = (id: Capability): void => {
    if (resolved.has(id)) return
    const metadata = index.get(id)
    if (!metadata) throw new Error(`Unknown capability metadata: ${id}`)
    resolved.add(id)
    for (const dependency of metadata.dependencies) visit(dependency)
  }
  for (const id of selected) visit(id)
  return resolved
}

function assertNoConflicts(
  capabilities: ReadonlySet<Capability>,
  index: ReadonlyMap<Capability, CapabilityMetadata>,
): void {
  for (const id of [...capabilities].sort()) {
    const metadata = index.get(id)
    if (!metadata) throw new Error(`Unknown capability metadata: ${id}`)
    for (const conflict of metadata.conflicts) {
      if (capabilities.has(conflict)) {
        throw new Error(`Capability conflict: ${id} conflicts with ${conflict}`)
      }
    }
  }
}

export function resolveCapabilities(
  input: unknown,
  options: CapabilityResolutionOptions = {},
): Capability[] {
  const selected = parseUniqueCapabilities(input)
  const index = catalogIndex(options.catalog ?? bundledCapabilityCatalog)
  const resolved = dependencyClosure(selected, index)
  assertNoConflicts(resolved, index)

  if (!options.allowExperimental) {
    const experimental = [...resolved]
      .filter((id) => index.get(id)?.support === 'experimental')
      .sort()
    if (experimental.length > 0) {
      throw new Error(`Experimental capabilities are not enabled: ${experimental.join(', ')}`)
    }
  }

  return [...resolved].sort()
}

export function getCapabilityApplicationOrder(
  input: unknown,
  catalog: unknown = bundledCapabilityCatalog,
): Capability[] {
  const capabilities = parseUniqueCapabilities(input)
  const index = catalogIndex(catalog)
  const selected = new Set(capabilities)

  for (const id of capabilities) {
    const metadata = index.get(id)
    if (!metadata) throw new Error(`Unknown capability metadata: ${id}`)
    for (const dependency of metadata.dependencies) {
      if (!selected.has(dependency)) {
        throw new Error(`Capability ${id} requires unresolved dependency ${dependency}`)
      }
    }
  }
  assertNoConflicts(selected, index)

  const dependencyCounts = new Map<Capability, number>()
  const dependents = new Map<Capability, Capability[]>()
  for (const id of capabilities) {
    const dependencies = index.get(id)?.dependencies ?? []
    dependencyCounts.set(id, dependencies.length)
    for (const dependency of dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), id])
    }
  }

  const ready = capabilities.filter((id) => dependencyCounts.get(id) === 0).sort()
  const ordered: Capability[] = []
  while (ready.length > 0) {
    const id = ready.shift()
    if (!id) break
    ordered.push(id)
    for (const dependent of [...(dependents.get(id) ?? [])].sort()) {
      const remaining = (dependencyCounts.get(dependent) ?? 0) - 1
      dependencyCounts.set(dependent, remaining)
      if (remaining === 0) {
        ready.push(dependent)
        ready.sort()
      }
    }
  }
  if (ordered.length !== capabilities.length)
    throw new Error('Capability dependency cycle detected')
  return ordered
}

export function parseCapabilityCatalog(input: unknown): CapabilityCatalog {
  const catalog = capabilityCatalogSchema.parse(input)
  assertAcyclicCatalog(new Map(catalog.map((metadata) => [metadata.id, metadata])))
  return catalog
}
