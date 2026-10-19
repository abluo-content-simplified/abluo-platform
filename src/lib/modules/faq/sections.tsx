// ── FAQ module — section component map (ADR-037) ──────────────────────────────
// Imported by src/lib/modules/sections.ts, never by registry.ts — the registry
// stays declarative and out of the Next.js bundle's way (see gallery/sections.tsx).

import { FAQSection } from '@/components/sections/FAQSection'
import type { FAQSection as FAQSectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { siteBasePath } from '@/lib/sanity/href'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantSlug: string
  hostScoped?: boolean
}

export const faqSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  faqSection: ({ section, surface, designSystem, locale, tenantSlug, hostScoped }) => (
    <FAQSection
      section={section as FAQSectionType}
      surface={surface}
      designSystem={designSystem}
      siteBase={siteBasePath(locale, tenantSlug, hostScoped)}
    />
  ),
}
