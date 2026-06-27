// ── Blog module — section component map ──────────────────────────────────────
// ADR-011 Phase D2 — Section Map Derivation.
//
// This file provides the React component wrappers for every section _type
// declared in the blog module's platformContract.sectionTypes.
//
// Design notes:
//
// This file is imported by src/lib/modules/sections.ts (the platform section
// map builder) — NOT by registry.ts. The registry remains purely declarative.
// Keeping React components out of the manifest prevents the Sanity Studio
// bundle from pulling in Next.js-specific rendering code.
//
// The BlogListingSection component uses `tenantId` as its prop name for the
// project slug; SectionRenderer passes it as `tenantSlug`. The wrapper below
// adapts the name so neither the component nor SectionRenderer needs changing.

import { BlogListingSection } from '@/components/sections/BlogListingSection'
import type { BlogListingSection as BlogListingSectionType, PageSection, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

// ── Local prop type ───────────────────────────────────────────────────────────
// Matches the ModuleSectionProps shape declared in sections.ts.
// Defined locally to avoid a circular type import (sections.ts imports this
// file; if this file imported from sections.ts at runtime the cycle would
// exist at module initialisation).
type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig: WebsiteSiteConfig | null
  locale: string
  tenantSlug: string
  fromParam?: string
}

// ── Blog section components ───────────────────────────────────────────────────

export const blogSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * blogListingSection — renders the blog post listing grid.
   * Data is pre-hydrated by the page before SectionRenderer is called;
   * this component is stateless with respect to data fetching.
   * Adapter: maps tenantSlug → tenantId (BlogListingSection's prop name).
   */
  blogListingSection: ({ section, surface, designSystem, locale, tenantSlug, fromParam }) => (
    <BlogListingSection
      section={section as BlogListingSectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
      tenantId={tenantSlug}
      fromParam={fromParam}
    />
  ),
}
