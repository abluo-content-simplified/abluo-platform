import type { DesignSystem, TimetableSection as TimetableSectionType } from '@/lib/sanity/types'
import { siteBasePath } from '@/lib/sanity/href'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { resolveEasing } from '@/lib/motion/easing'
import { profileSegmentFor } from '@/lib/modules/people/website'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import { TimetableView } from '@/components/sections/timetable/TimetableView'
import { TimetableNotes } from '@/components/sections/timetable/TimetableNotes'

interface Props {
  section: TimetableSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** Module config — the People profile segment, for teacher links. */
  moduleConfig?: ProjectModuleConfig
  /** Page (content) locale — picks the dictionary labels and the date formats. */
  locale?: string
  /** The `[tenant]` URL segment. */
  tenantSlug: string
  hostScoped?: boolean
}

/**
 * TimetableSection — presentation of the site's weekly classes (Sections vs
 * Modules: the section owns no data). Classes, teachers and places are
 * hydrated per request by hydrateSections (timetable-section.server.ts); a
 * section that was not hydrated renders nothing. All labels come from the
 * timetable dictionary for the page's content locale.
 */
export function TimetableSection({ section, surface, designSystem, moduleConfig, locale = 'en', tenantSlug, hostScoped }: Props) {
  const hydrated = section.timetable
  if (!hydrated) return null

  const { eyebrow, title, intro } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const siteBase = siteBasePath(locale, tenantSlug, hostScoped)
  const profile = moduleConfig ? { siteBase, segment: profileSegmentFor(moduleConfig, locale) } : null
  const hasHeader = !!(eyebrow || title || intro)
  // Notes are rendered here (server) and handed to the interactive part as elements. Members' notes exist on the
  // section only when the server kept them for a granted visitor (hydrateTimetableSection) — nothing is decided here.
  const notes = <TimetableNotes blocks={section.notes} siteBase={siteBase} projectSlug={tenantSlug} className="text-sm leading-relaxed" />
  const membersNotes = <TimetableNotes blocks={section.membersNotes} siteBase={siteBase} projectSlug={tenantSlug} className="text-sm leading-relaxed" />
  const hasNotes = Array.isArray(section.notes) && section.notes.length > 0
  const hasMembersNotes = Array.isArray(section.membersNotes) && section.membersNotes.length > 0

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-10 max-w-2xl">
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} className="mb-4" />}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p className="mt-6 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
              {intro}
            </p>
          )}
        </SlideUp>
      )}
      <SlideUp duration={duration} ease={ease} delay={0.08}>
        <TimetableView
          locale={locale}
          initial={{ month: hydrated.month, today: hydrated.today, data: hydrated.data, onlineDetails: hydrated.onlineDetails }}
          defaultView={section.defaultView === 'month' ? 'month' : 'week'}
          allowViewSwitch={section.allowViewSwitch !== false}
          showPrintButton={section.showPrintButton !== false}
          showCourseDescriptions={section.showCourseDescriptions === true}
          title={title ?? ''}
          endpoint={hydrated.pageId ? `${siteBase}/site-access/timetable` : null}
          calendarEndpoint={hydrated.pageId ? `${siteBase}/site-access/timetable-calendar` : null}
          pageId={hydrated.pageId}
          sectionKey={section._key}
          profile={profile}
          siteHost={hydrated.siteHost ?? null}
          eventsBase={`${siteBase}/events`}
          notes={hasNotes ? notes : null}
          membersNotes={hasMembersNotes ? membersNotes : null}
        />
      </SlideUp>
    </SectionContainer>
  )
}
