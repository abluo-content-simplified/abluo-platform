// ── Testimonials module — section component map (ADR-048) ─────────────────────
// Imported by src/lib/modules/sections.ts, never by registry.ts (see faq/sections.tsx).
// The data comes from hydrateTestimonialsSection (./website.ts), which
// hydrateSections calls before rendering and which fills `section.testimonialItems`.

import { TestimonialsSection } from '@/components/sections/TestimonialsSection'
import type { TestimonialsSection as TestimonialsSectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

export const testimonialsSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  testimonialsSection: ({ section, surface, designSystem, locale }) => (
    <TestimonialsSection section={section as TestimonialsSectionType} surface={surface} designSystem={designSystem} locale={locale} />
  ),
}
