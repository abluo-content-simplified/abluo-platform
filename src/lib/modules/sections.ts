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
import type { SurfaceType } from '@/lib/sanity/surfaces'

// ── Module section imports ────────────────────────────────────────────────────
// One import per module that contributes sections.
import { blogSectionComponents } from './blog/sections'
import { eventsSectionComponents } from './events/sections'
import { liveSectionComponents } from './live/sections'

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
  ...eventsSectionComponents,
  ...liveSectionComponents,
  // Future modules: spread their section component maps here.
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
