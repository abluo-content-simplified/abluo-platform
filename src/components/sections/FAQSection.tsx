import type { FAQSection as FAQSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { FaqPlacement } from '@/components/faq/FaqPlacement'
import { sectionFaqGroups } from '@/lib/faq/collect'

// ── FAQ section (FAQ module, ADR-037 D5) ──────────────────────────────────────
// Presentation only. The questions come from the FAQ sets the section
// references (maintained in the library), else — until migration 008 converts
// them — from its deprecated inline items. The heading (eyebrow, title, accent,
// subtitle) belongs to the section; the questions render through FaqPlacement,
// the same renderer a blog post uses. No visible question → no section.
//
// A server component now: answers are rich text rendered on the server and
// handed to the client accordion as nodes. The accordion markup is unchanged.

interface Props {
  section: FAQSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** Link prefix of this site, for internal links in answers. */
  siteBase?: string
}

export function FAQSection({ section, surface, designSystem, siteBase = '' }: Props) {
  const { eyebrow, title, headlineAccent, subtitle } = section
  const groups = sectionFaqGroups(section)
  if (groups.length === 0) return null

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for section entrance (accordion: FaqPlacement)
  const m = designSystem?.motion
  const entranceDuration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="max-w-[680px]">
        {/* Section header — SlideUp, consistent with all other sections */}
        <SlideUp duration={entranceDuration} ease={ease} delay={0}>
          {eyebrow && (
            <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" className="mb-4" />
          )}
          {title && (
            <h2
              className={`${subtitle ? 'mb-4' : 'mb-12'} [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]`}
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {renderHeadline(title, headlineAccent)}
            </h2>
          )}
          {subtitle && (
            <p className="mb-12 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {subtitle}
            </p>
          )}
        </SlideUp>

        {/* FAQ list — SlideUp with slight delay after header */}
        <SlideUp duration={entranceDuration} ease={ease} delay={0.1}>
          <FaqPlacement groups={groups} showSetTitles={section.showSetTitles} siteBase={siteBase} designSystem={designSystem} />
        </SlideUp>
      </div>
    </SectionContainer>
  )
}
