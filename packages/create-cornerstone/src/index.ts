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
  projectManifestSchema,
  resolveManifest,
  resolvedManifestSchema,
} from './schema.js'
export type {
  ProjectLockData,
  ProjectLockV1Data,
  ProjectLockV2Data,
  ProjectManifest,
  ResolvedManifest,
} from './schema.js'
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
