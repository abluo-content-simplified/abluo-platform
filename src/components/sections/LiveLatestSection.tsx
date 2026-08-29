// ─── Live — Current Event Section ──────────────────────────────────────────
// ADR-016 Phase B — composable version of the "current live event" hero
// treatment already rendered on the fixed /live page
// (src/components/livener/live/LivePageContent.tsx). Reuses
// FeaturedEventBlock — the exact component LivePageContent uses to render
// status/title/date/image/CTA for the current event — so the section matches
// the existing live hero pixel-for-pixel instead of re-implementing it.
//
// Data (`event`) is hydrated server-side by hydrateSections in
// SectionRenderer.tsx via currentLiveEventQuery — the same query and the same
// selection precedence (featured-on-live-page → live status → next upcoming)
// used by the fixed /live route. Owned by the Live module — registered via
// src/lib/modules/live/sections.tsx into SECTION_MAP.

import type { LiveLatestSection as LiveLatestSectionType, DesignSystem, SupportedLocale } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { SectionEmptyState } from '@/components/sections/shared/SectionEmptyState'
import { FeaturedEventBlock } from '@/components/events/FeaturedEventBlock'
import { getLivePageMessages } from '@/lib/i18n/live-page-messages'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: LiveLatestSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantId: string
}

export function LiveLatestSection({ section, surface, designSystem, locale, tenantId }: Props) {
  const { eyebrow, title, event, emptyStateHeading, emptyStateBody } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections (matches BlogListingSection / EventsListingSection)
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  // ADR-016 Phase C — liveLatestSection intentionally overrides the generic
  // "empty + unset → render nothing" rule used by blogListingSection /
  // eventsListingSection: the live page must always communicate live status.
  // Admin-authored emptyStateHeading/Body (if set) take precedence; otherwise
  // fall back to the platform i18n dictionary (getLivePageMessages) so the
  // message is still localized rather than silently absent.
  if (!event) {
    const msg = getLivePageMessages(locale)
    const heading = emptyStateHeading ?? msg.noLiveEventHeading
    const body = emptyStateBody ?? msg.noLiveEventBody
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <SectionEmptyState heading={heading} body={body} duration={duration} ease={ease} />
      </SectionContainer>
    )
  }

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {(eyebrow || title) && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              className="mb-4"
            />
          )}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
        </SlideUp>
      )}

      <FeaturedEventBlock
        event={event}
        designSystem={designSystem}
        locale={locale as SupportedLocale}
        tenantId={tenantId}
      />
    </SectionContainer>
  )
}
