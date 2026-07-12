import type { ProjectIntegrations, ProjectPrivacy, CustomScript } from '@/lib/sanity/types'

// ─── Tracking Resolution (pure, testable) ──────────────────────────────────────
//
// ADR-014 Phase C. Bridges the Integration Registry runtime shape
// (`ProjectIntegrations` — `project.integrationConfigs` + `project.privacy`,
// sourced by `projectIntegrationsQuery`, `src/lib/sanity/queries.ts`) to the
// flat value set `TrackingScripts.tsx` renders from. Extracted as a pure
// function (mirrors the `filterCustomScripts` extraction, Sprint 1 Round 2)
// so the "which integration renders with which value" decision is unit
// testable without a React render tree.
//
// ── Semantic contract (preserve exactly — ADR-013 + ADR-014) ──────────────────
//
// 1. Kill switch — `privacy.trackingKillSwitch === true` blanks EVERYTHING:
//    every returned value is omitted/empty, `killSwitched: true`. This is the
//    project-level emergency override (ADR-014 Phase B `project.privacy`) and
//    supersedes `analyticsEnabled` as the platform's master gate — there is no
//    longer a single `analyticsEnabled` flag; the equivalent "nothing renders"
//    behavior is now the kill switch.
//
// 2. Per-integration fail-closed default — with the kill switch off, each
//    value is present only when BOTH:
//      a. that integration's `IntegrationConfig` entry has `enabled === true`
//         (strict — `undefined`/`false` omit the value, matching
//         `filterCustomScripts`' `enabled !== true` fail-closed rule), AND
//      b. the read value is a non-empty string (scalars) or a present array
//         (custom scripts) — an enabled integration with a blank/missing
//         value still renders nothing for that value.
//    Unknown `integrationId`s in `configs` (anything not in
//    `INTEGRATION_REGISTRY`, src/lib/integrations/registry.ts) are ignored —
//    this resolver only ever reads the four known ids below.
//
// 3. `consentModeEnabled` is passed through unchanged (`privacy.consentModeEnabled
//    === true`) for the caller to feed into the EXISTING, unmodified
//    `builtInTrackingAllowed()` / `consentStateFor()` helpers
//    (`src/lib/tracking/custom-scripts.ts`). This function does not
//    reimplement consent gating — it only resolves which values exist to gate.
//
// 4. Registry id → value mapping (the only integrations this resolver knows
//    about — see `src/lib/integrations/manifests/*`):
//      - 'google-analytics'    → values.measurementId → ga4MeasurementId
//      - 'google-tag-manager'  → values.containerId   → gtmContainerId
//      - 'meta-pixel'          → values.pixelId        → metaPixelId
//      - 'custom-scripts'      → values.scripts        → customScripts
//
// Production gating (`isProduction()`) is NOT this function's concern — that
// stays in `TrackingScripts.tsx`, unchanged.

export interface ResolvedTracking {
  /** True when `privacy.trackingKillSwitch === true` — every other field is empty/omitted. */
  killSwitched: boolean
  /** Passthrough of `privacy.consentModeEnabled === true`, for `builtInTrackingAllowed`/`consentStateFor`. */
  consentModeEnabled: boolean
  /** Present only when the 'google-analytics' config entry is `enabled === true` with a non-empty `values.measurementId`. */
  ga4MeasurementId?: string
  /** Present only when the 'google-tag-manager' config entry is `enabled === true` with a non-empty `values.containerId`. */
  gtmContainerId?: string
  /** Present only when the 'meta-pixel' config entry is `enabled === true` with a non-empty `values.pixelId`. */
  metaPixelId?: string
  /** Present only when the 'custom-scripts' config entry is `enabled === true` and `values.scripts` is an array; empty array otherwise. */
  customScripts: CustomScript[]
}

type IntegrationConfigs = ProjectIntegrations['integrationConfigs']
type IntegrationConfigEntry = NonNullable<IntegrationConfigs>[number]

// Registry ids this resolver reads. Mirrors src/lib/integrations/registry.ts —
// kept as local literals (not imported) because this module only needs the
// four id strings, not the full manifest shape.
const GOOGLE_ANALYTICS_ID = 'google-analytics'
const GOOGLE_TAG_MANAGER_ID = 'google-tag-manager'
const META_PIXEL_ID = 'meta-pixel'
const CUSTOM_SCRIPTS_ID = 'custom-scripts'

function findConfig(
  configs: IntegrationConfigs,
  integrationId: string
): IntegrationConfigEntry | undefined {
  return configs?.find((c) => c.integrationId === integrationId)
}

/** Strict `enabled === true` + non-empty string value, or `undefined`. */
function resolveStringValue(
  config: IntegrationConfigEntry | undefined,
  field: string
): string | undefined {
  if (!config || config.enabled !== true) return undefined
  const value = config.values?.[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Strict `enabled === true` + array value, or `[]`. */
function resolveScripts(config: IntegrationConfigEntry | undefined): CustomScript[] {
  if (!config || config.enabled !== true) return []
  const value = config.values?.['scripts']
  return Array.isArray(value) ? (value as CustomScript[]) : []
}

/**
 * Resolves the flat tracking value set `TrackingScripts.tsx` needs from the
 * Integration Registry runtime shape (`project.integrationConfigs` +
 * `project.privacy`). See the module-level contract above — kill switch wins
 * first, then each value independently requires `enabled === true` on its
 * own config entry.
 */
export function resolveTracking(
  configs: IntegrationConfigs,
  privacy: ProjectPrivacy | undefined
): ResolvedTracking {
  const killSwitched = privacy?.trackingKillSwitch === true
  const consentModeEnabled = privacy?.consentModeEnabled === true

  if (killSwitched) {
    return { killSwitched: true, consentModeEnabled, customScripts: [] }
  }

  return {
    killSwitched: false,
    consentModeEnabled,
    ga4MeasurementId: resolveStringValue(findConfig(configs, GOOGLE_ANALYTICS_ID), 'measurementId'),
    gtmContainerId: resolveStringValue(findConfig(configs, GOOGLE_TAG_MANAGER_ID), 'containerId'),
    metaPixelId: resolveStringValue(findConfig(configs, META_PIXEL_ID), 'pixelId'),
    customScripts: resolveScripts(findConfig(configs, CUSTOM_SCRIPTS_ID)),
  }
}
