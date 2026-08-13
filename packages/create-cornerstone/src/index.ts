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
  apiAuthorizationContract,
  canonicalScaffoldId,
  computeScaffoldOptionsDigest,
  computeScaffoldsDigest,
  isGeneratorControlPath,
  portableScaffoldPathsConflict,
  scaffoldKindSchema,
  scaffoldPathSchema,
  scaffoldRegistryEntrySchema,
  scaffoldRegistrySchema,
  validateScaffoldOptionsDigest,
  validateScaffoldRegistry,
} from './scaffold/registry.js'
export type { ScaffoldKind, ScaffoldRegistryEntry } from './scaffold/registry.js'
export { generateScaffold, planScaffoldGeneration } from './scaffold/generator.js'
export type { ScaffoldPlan } from './scaffold/generator.js'
export { renderScaffold } from './scaffold/render.js'
export type { RenderedScaffold, ScaffoldGenerateOptions } from './scaffold/render.js'
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
export { adoptStandardV3, planStandardV3Adoption } from './mutation/adoption.js'
export type { StandardV3AdoptionPlan } from './mutation/adoption.js'
export { adoptStandardV4, planStandardV4Adoption } from './mutation/standard-v4-adoption.js'
export type { StandardV4AdoptionPlan } from './mutation/standard-v4-adoption.js'
export { adoptStandardV5, planStandardV5Adoption } from './mutation/standard-v5-adoption.js'
export type { StandardV5AdoptionPlan } from './mutation/standard-v5-adoption.js'
export { adoptStandardV6, planStandardV6Adoption } from './mutation/standard-v6-adoption.js'
export type { StandardV6AdoptionPlan } from './mutation/standard-v6-adoption.js'
