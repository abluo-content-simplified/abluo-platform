// ── News module — section component map ──────────────────────────────────────
// ADR-020, following the ADR-011 Phase D2 Section Map Derivation pattern.
//
// Provides the React component wrapper for every section _type declared in the
// news module's platformContract.sectionTypes.
//
// Imported by src/lib/modules/sections.ts (the platform section map builder) —
// NOT by registry.ts. The registry stays purely declarative so that React
// components never reach the Sanity Studio bundle.

import { NewsListingSection } from '@/components/sections/NewsListingSection'
import type {
  NewsListingSection as NewsListingSectionType,
  PageSection,
  DesignSystem,
  WebsiteSiteConfig,
} from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import type { ProjectModuleConfig } from '../config'

// ── Local prop type ───────────────────────────────────────────────────────────
// Matches the ModuleSectionProps shape declared in ../sections.ts. Defined
// locally to avoid a circular import: sections.ts imports this file, so
// importing the type back from it at runtime would create a cycle at module
// initialisation.
type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig: WebsiteSiteConfig | null
  moduleConfig?: ProjectModuleConfig
  locale: string
  tenantSlug: string
  fromParam?: string
}

// ── News section components ───────────────────────────────────────────────────

export const newsSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * newsListingSection — renders the news listing.
   * Items are pre-hydrated by hydrateSections before SectionRenderer runs, so
   * this component does no data fetching of its own.
   * Adapter: maps tenantSlug → tenantId (the component's prop name).
   */
  newsListingSection: ({ section, surface, designSystem, locale, tenantSlug, fromParam }) => (
    <NewsListingSection
      section={section as NewsListingSectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
      tenantId={tenantSlug}
      fromParam={fromParam}
    />
  ),
}
