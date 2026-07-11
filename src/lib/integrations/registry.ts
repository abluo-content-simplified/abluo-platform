import type { IntegrationCategory, IntegrationManifest } from './types'
import { validateIntegrationRegistry } from './validate'
import googleAnalytics from './manifests/google-analytics'
import googleTagManager from './manifests/google-tag-manager'
import metaPixel from './manifests/meta-pixel'
import customScripts from './manifests/custom-scripts'

// ── Integration registry ──────────────────────────────────────────────────────
// The single authoritative definition of every third-party integration
// available on the platform. Mirrors src/lib/modules/registry.ts's shape and
// comment style exactly (ADR-011 precedent; ADR-014 Phase A applies the same
// pattern to integrations).
//
// Adding an integration: write one manifest file in manifests/, add it here.
// Schema (buildIntegrationSchemaTypes), validation (validateIntegrationRegistry),
// and the future Studio IntegrationsPane (Phase B) all derive from this array —
// no other file needs to change.
export const INTEGRATION_REGISTRY: IntegrationManifest[] = [
  googleAnalytics,
  googleTagManager,
  metaPixel,
  customScripts,
]

// ── Integration categories ────────────────────────────────────────────────────
// Ordered per ADR-014's Studio IA. Non-functional in Phase A — reserved for the
// future IntegrationsPane category index (Phase B), the same "declared now,
// consumed later" convention modules/types.ts uses for ModuleCategory.
// A category with no registered manifest renders as coming-soon; that is
// derived from this list plus INTEGRATION_REGISTRY, never hardcoded per category.
export const INTEGRATION_CATEGORIES: { id: IntegrationCategory; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'forms', label: 'Forms' },
  { id: 'ai', label: 'AI' },
  { id: 'payments', label: 'Payments' },
  { id: 'developers', label: 'Developers' },
]

// ── Build-time validation ─────────────────────────────────────────────────────
// Runs at module load time. Throws with a human-readable diagnostic if any
// manifest violates the structural rules defined in validate.ts.
// A throw here propagates as a build error in Next.js and Sanity Studio.
validateIntegrationRegistry(INTEGRATION_REGISTRY)
