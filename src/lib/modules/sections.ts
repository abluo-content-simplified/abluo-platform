// ── Module section map ────────────────────────────────────────────────────────
// ADR-011 Phase D2 — Section Map Derivation.
//
// SECTION_MAP is the single authoritative lookup from Sanity _type strings to
// the React components that render them — for module-owned sections only.
//
// Platform-owned sections (heroSection, contentSection, treatmentsSection,
// teamSection, textSection, faqSection, contactSection, statementSection,
// formSection, metricsSection, heroLiveCaptureSection, heroLensSection) are
// NOT in this map. They remain in the SectionRenderer switch statements as
// platform-managed registrations, consistent with the Sections vs Modules
// design principle established in ADR-011 Phase D1.
//
// Design notes:
//
// This file imports module section component files DIRECTLY — it does not go
// through registry.ts. The registry is purely declarative (ids, labels,
// sectionTypes: string[], schemaTypes: string[], permissions, etc.). Storing
// React components in the manifest would pull Next.js-specific code into the
// Sanity Studio bundle. The separation is intentional and must be maintained.
//
// SECTION_MAP is computed once at module initialisation (import time). It is
// never rebuilt inside a render function.
//
// Adding a new module section:
//   1. Create src/lib/modules/{module}/sections.tsx with the component wrapper.
//   2. Import its map below and spread it into SECTION_MAP.
//   3. Declare the _type string in that module's platformContract.sectionTypes.
//   Steps 1–3 are the only changes required — neither SectionRenderer file
//   needs modification.

import type { ReactNode } from 'react'
import type { PageSection, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import type { ProjectModuleConfig } from './config'
import type { SurfaceType } from '@/lib/sanity/surfaces'

// ── Module section imports ────────────────────────────────────────────────────
// One import per module that contributes sections.
import { blogSectionComponents } from './blog/sections'
import { newsSectionComponents } from './news/sections'
import { eventsSectionComponents } from './events/sections'
import { liveSectionComponents } from './live/sections'

// ── Availability gating (ADR-016 Phase D) ──────────────────────────────────────
// MODULE_REGISTRY is safe to import statically here: this file is Next.js-route
// only (see the isolation boundary note in ./index.ts) and registry.ts carries
// no sanity/structure import, so nothing leaks into the Studio bundle.
import { MODULE_REGISTRY } from './registry'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The full prop set passed by SectionRenderer to every module-registered
 * section component. Module sections destructure only the props they need;
 * extra props are silently ignored by React.
 *
 * Mirrors the SectionRenderer function signature so that any module section
 * has access to the same context that platform sections receive.
 */
export type ModuleSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig: WebsiteSiteConfig | null
  /** ADR-020 — module-owned per-website configuration (projectModuleConfigQuery). */
  moduleConfig?: ProjectModuleConfig
  locale: string
  tenantSlug: string
  fromParam?: string
}

/**
 * A map from Sanity _type string to the React component that renders it.
 * Values are render functions rather than React.ComponentType to avoid
 * TypeScript friction with async server components.
 */
export type SectionComponentMap = Record<string, (props: ModuleSectionProps) => ReactNode>

// ── Section map ───────────────────────────────────────────────────────────────

/**
 * The merged section component map for all modules.
 * Computed once at module initialisation — never inside a render function.
 *
 * SectionRenderer usage:
 *   const ModuleSection = SECTION_MAP[section._type]
 *   if (ModuleSection) return <ModuleSection {...sectionRendererProps} />
 *   // fall through to platform switch
 */
export const SECTION_MAP: SectionComponentMap = {
  ...blogSectionComponents,
  ...newsSectionComponents,
  ...eventsSectionComponents,
  ...liveSectionComponents,
  // Future modules: spread their section component maps here.
}

// ── Section-type → owning-module lookup (ADR-016 Phase D) ─────────────────────
//
// A section type appearing in some module's platformContract.sectionTypes is
// module-owned; a section type appearing in NO manifest is a platform section
// (heroLensSection, heroLiveCaptureSection, contentSection, etc.) and is never
// gated by module installation — Section Library vs Modules principle, CLAUDE.md.
//
// Computed once at module initialisation, mirroring SECTION_MAP above.
const SECTION_TYPE_TO_MODULE_ID: Record<string, string> = {}
for (const manifest of MODULE_REGISTRY) {
  for (const sectionType of manifest.platformContract.sectionTypes) {
    SECTION_TYPE_TO_MODULE_ID[sectionType] = manifest.id
  }
}

/**
 * Pure predicate: is a section type available for render given the tenant's
 * enabled module IDs?
 *
 * - Module-owned section type (found in some manifest's sectionTypes) →
 *   available iff its owning module's ID is in enabledModuleIds.
 * - Platform section type or any type not declared by any module manifest →
 *   always available. This includes genuinely unknown/unmapped _type values:
 *   SectionRenderer's platform switch statement already returns null for any
 *   _type it doesn't recognise, so this predicate does not need to duplicate
 *   that closed-world check — it only needs to answer the module-ownership
 *   question. Defaulting unmapped types to "available" keeps this predicate
 *   decoupled from the platform switch's set of cases (Sections vs Modules
 *   orthogonality) and avoids ever hiding a platform section because of a
 *   gating bug.
 *
 * Safe-default contract for enabledModuleIds — this is the load-bearing part
 * of the predicate, not an incidental null-check:
 *
 * - `undefined` / `null` means "the tenant's installed-module set could not
 *   be resolved" (fetch failed, project doc not found, resolution not wired
 *   for this caller yet). This must FAIL OPEN — treat as available — so a
 *   transient resolution problem never silently blanks a tenant's existing
 *   blogListingSection / eventsListingSection / liveLatestSection content.
 *   Hiding a section an admin expects to see is a worse failure mode here
 *   than occasionally rendering one for a module that turns out to be
 *   uninstalled.
 * - `[]` (a real, successfully resolved empty array) means "this tenant has
 *   zero modules installed" — a legitimate, common state for a fresh project
 *   — and DOES gate module-owned sections off. Only an actually-resolved
 *   list drives gating; the mere absence of a value never does.
 */
export function isSectionTypeAvailable(
  sectionType: string,
  enabledModuleIds: string[] | undefined | null
): boolean {
  const ownerModuleId = SECTION_TYPE_TO_MODULE_ID[sectionType]
  // Platform section, or a type no module claims — never gated.
  if (!ownerModuleId) return true
  // Resolution unavailable — fail open rather than blank existing content.
  if (enabledModuleIds == null) return true
  return enabledModuleIds.includes(ownerModuleId)
}

// ── Registry cross-check ──────────────────────────────────────────────────────
// Warn at initialisation if any module declares a sectionType that has no
// corresponding entry in SECTION_MAP. Catches the case where a developer adds
// a type to sectionTypes but forgets to create the component.
// Runs only once at module load time — no runtime overhead per render.
if (process.env.NODE_ENV !== 'production') {
  // Lazy import to avoid pulling registry into the Studio bundle via this file.
  // This check runs only in development and is stripped from production builds.
  import('./registry').then(({ MODULE_REGISTRY }) => {
    const registeredTypes = new Set(Object.keys(SECTION_MAP))
    for (const manifest of MODULE_REGISTRY) {
      for (const sectionType of manifest.platformContract.sectionTypes) {
        if (!registeredTypes.has(sectionType)) {
          console.warn(
            `[ADR-011] Module "${manifest.id}" declares sectionType "${sectionType}" ` +
            `in platformContract.sectionTypes but no component is registered in SECTION_MAP. ` +
            `Add it to src/lib/modules/${manifest.id}/sections.tsx.`
          )
        }
      }
    }
  })
}
