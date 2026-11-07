// ── Courses module — section component map (ADR-045, build spec §5) ──────────
// Imported by src/lib/modules/sections.ts, never by registry.ts (React must stay
// out of the Studio bundle — see faq/sections.tsx).

import { TimetableSection } from '@/components/sections/TimetableSection'
import { CourseListSection } from '@/components/sections/CourseListSection'
import type { TimetableSection as TimetableSectionType, CourseListSection as CourseListSectionType, PageSection, DesignSystem } from '@/lib/sanity/types'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import type { ProjectModuleConfig } from '@/lib/modules/config'

type LocalSectionProps = {
  section: PageSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  moduleConfig?: ProjectModuleConfig
  locale: string
  tenantSlug: string
  hostScoped?: boolean
}

export const coursesSectionComponents: Record<string, (props: LocalSectionProps) => React.ReactNode> = {
  /**
   * timetableSection — week / month timetable. Data is pre-hydrated by
   * hydrateSections (SectionRenderer.tsx) per request; the component renders
   * nothing when it is missing.
   */
  timetableSection: ({ section, surface, designSystem, moduleConfig, locale, tenantSlug, hostScoped }) => (
    <TimetableSection
      section={section as TimetableSectionType}
      surface={surface}
      designSystem={designSystem}
      moduleConfig={moduleConfig}
      locale={locale}
      tenantSlug={tenantSlug}
      hostScoped={hostScoped}
    />
  ),
  /**
   * courseListSection — course cards linking to each course's own page
   * (ADR-045 D5). Pre-hydrated by hydrateSections; renders nothing without data.
   */
  courseListSection: ({ section, surface, designSystem, moduleConfig, locale, tenantSlug, hostScoped }) => (
    <CourseListSection
      section={section as CourseListSectionType}
      surface={surface}
      designSystem={designSystem}
      moduleConfig={moduleConfig}
      locale={locale}
      tenantSlug={tenantSlug}
      hostScoped={hostScoped}
    />
  ),
}
