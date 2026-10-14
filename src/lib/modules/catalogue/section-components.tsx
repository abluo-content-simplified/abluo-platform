// ── Catalogue module — section component map (ADR-033, spec §4.6) ─────────────
// Imported by src/lib/modules/sections.ts (SECTION_MAP), never by registry.ts —
// the registry stays declarative and out of the Next.js bundle (see
// blog/sections.tsx).
//
// Named section-components.tsx, not sections.tsx: ./sections.ts already holds
// the collection-tree functions (readingOrder…), and a sibling sections.tsx
// would make `./sections` ambiguous to the module resolver.

import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as CatalogueListingSectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantSlug: string
  hostScoped?: boolean
}

export const catalogueSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * catalogueListingSection — one collection. Data is pre-hydrated by
   * hydrateSections (SectionRenderer.tsx); without an enabled catalogue
   * installation the section is gated off before it gets here, and renders
   * nothing even if it is reached (no hydrated data).
   */
  catalogueListingSection: ({ section, surface, designSystem, locale, tenantSlug, hostScoped }) => (
    <CatalogueListingSection
      section={section as CatalogueListingSectionType}
      surface={surface}
      designSystem={designSystem}
      locale={locale}
      tenantSlug={tenantSlug}
      hostScoped={hostScoped}
    />
  ),
}
