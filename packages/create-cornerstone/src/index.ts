export {
  createProject,
  createProjectFromManifest,
  planProject,
  readManifest,
  verifyProject,
} from './generator.js'
export type { ProjectLock } from './generator.js'
export {
  capabilitySchema,
  projectLockSchema,
  projectLockV1Schema,
  projectLockV2Schema,
  projectLockV3Schema,
  projectManifestSchema,
  resolveManifest,
  resolvedManifestSchema,
} from './schema.js'
export type {
  ProjectLockData,
  ProjectLockV1Data,
  ProjectLockV2Data,
  ProjectLockV3Data,
  ProjectManifest,
  ResolvedManifest,
} from './schema.js'
export {
  canonicalScaffoldId,
  computeScaffoldsDigest,
  isGeneratorControlPath,
  portableScaffoldPathsConflict,
  scaffoldKindSchema,
  scaffoldPathSchema,
  scaffoldRegistryEntrySchema,
  scaffoldRegistrySchema,
  validateScaffoldRegistry,
} from './scaffold/registry.js'
export type { ScaffoldKind, ScaffoldRegistryEntry } from './scaffold/registry.js'
export {
  bundledCapabilityCatalog,
  capabilityCatalogSchema,
  capabilityMetadataSchema,
  capabilitySupportSchema,
} from './composition/catalog.js'
export type { Capability, CapabilityCatalog, CapabilityMetadata } from './composition/catalog.js'
export {
  getCapabilityApplicationOrder,
  parseCapabilityCatalog,
  resolveCapabilities,
} from './composition/resolver.js'
export type { CapabilityResolutionOptions } from './composition/resolver.js'
export { formatJsonDocument, mergeJsonContributions } from './composition/composer.js'
export type { JsonContribution, JsonValue } from './composition/composer.js'
export {
  canonicalTemplateMetadataSchema,
  composerDefinitionSchema,
  validateCanonicalOwnership,
} from './composition/template.js'
export type { CanonicalTemplateMetadata, ComposerDefinition } from './composition/template.js'
export { planProjectUpdate, updateProject } from './update.js'
export type { ProjectUpdatePlan } from './update.js'
