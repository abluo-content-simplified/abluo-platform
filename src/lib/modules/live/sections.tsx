// ── Live module — section component map ───────────────────────────────────────
// ADR-016 Phase B — mirrors src/lib/modules/blog/sections.tsx exactly.
//
// This file provides the React component wrapper for the live module's
// platformContract.sectionTypes entry (liveLatestSection). Imported by
// src/lib/modules/sections.ts (the platform section map builder) — NOT by
// registry.ts, for the same React/Studio-bundle separation reason documented
// in blog/sections.tsx.
//
// Note: heroLiveCaptureSection and heroLensSection are platform-distributed
// section templates (see src/lib/modules/live/schema.ts header comment) and
// are registered directly in SectionRenderer.tsx, NOT here. Only
// liveLatestSection is module-owned.

import { LiveLatestSection } from '@/components/sections/LiveLatestSection'
import type { LiveLatestSection as LiveLatestSectionType, PageSection, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

// ── Local prop type ───────────────────────────────────────────────────────────
// Matches the ModuleSectionProps shape declared in sections.ts.
type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig: WebsiteSiteConfig | null
  locale: string
  tenantSlug: string
  fromParam?: string
}

// ── Live section components ───────────────────────────────────────────────────

export const liveSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * liveLatestSection — renders the current/next-upcoming live event,
   * hero-style. Data (`event`) is pre-hydrated by hydrateSections
   * (SectionRenderer.tsx) via currentLiveEventQuery before this component is
   * invoked. Adapter: maps tenantSlug → tenantId (LiveLatestSection's prop
   * name), mirroring blogSectionComponents.
   */
  liveLatestSection: ({ section, surface, designSystem, locale, tenantSlug }) => (
    <LiveLatestSection
      section={section as LiveLatestSectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
      tenantId={tenantSlug}
    />
  ),
}
