// ── Integration infrastructure barrel ────────────────────────────────────────
// ADR-014 Phase A — Integration Registry & the One-Configuration-Surface Principle.
// Mirrors src/lib/modules/index.ts's barrel structure and comment style.
//
// Phase A: registry + manifests + generated schema + validation.
// Phase B (not yet built): IntegrationsPane, Privacy section, IA rewire.
// Phase C (not yet built): TrackingScripts reads integrationConfigs.
// Phase D (not yet built): docs cross-references.

export {
  type IntegrationCategory,
  type IntegrationFieldDef,
  type IntegrationManifest,
  type IntegrationConfig,
} from './types'

export { INTEGRATION_REGISTRY, INTEGRATION_CATEGORIES } from './registry'

export { validateIntegrationRegistry } from './validate'

export {
  buildIntegrationSchemaTypes,
  buildIntegrationConfigsField,
  integrationValuesTypeName,
  integrationConfigTypeName,
} from './schema'

export {
  getIntegrationStatus,
  type IntegrationStatus,
  type IntegrationStatusValue,
  type PrivacySettings,
} from './status'
