// ── Events module — section component map ─────────────────────────────────────
// ADR-016 Phase B — mirrors src/lib/modules/blog/sections.tsx exactly.
//
// This file provides the React component wrapper for the events module's
// platformContract.sectionTypes entry (eventsListingSection). Imported by
// src/lib/modules/sections.ts (the platform section map builder) — NOT by
// registry.ts, for the same React/Studio-bundle separation reason documented
// in blog/sections.tsx.
//
// The EventsListingSection component uses `tenantId` as its prop name for the
// project slug; SectionRenderer passes it as `tenantSlug`. The wrapper below
// adapts the name so neither the component nor SectionRenderer needs changing.

import { EventsListingSection } from '@/components/sections/EventsListingSection'
import type { EventsListingSection as EventsListingSectionType, PageSection, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
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

// ── Events section components ─────────────────────────────────────────────────

export const eventsSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * eventsListingSection — renders the event listing grid.
   * Data is pre-hydrated by hydrateSections (SectionRenderer.tsx) before this
   * component is invoked; the component itself is stateless with respect to
   * data fetching. Adapter: maps tenantSlug → tenantId (EventsListingSection's
   * prop name), mirroring blogSectionComponents.
   */
  eventsListingSection: ({ section, surface, designSystem, locale, tenantSlug, fromParam }) => (
    <EventsListingSection
      section={section as EventsListingSectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
      tenantId={tenantSlug}
      fromParam={fromParam}
    />
  ),
}
