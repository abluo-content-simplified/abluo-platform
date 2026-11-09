import type { TestimonialsSection as TestimonialsSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { multiline } from '@/lib/multiline-text'
import { TestimonialsView } from '@/components/testimonials/TestimonialsView'
import { formatTestimonialMessage, getTestimonialMessages } from '@/lib/i18n/testimonials-messages'
import { toCardView } from '@/lib/modules/testimonials/view'
import { DEFAULT_TESTIMONIAL_LAYOUT } from '@/lib/modules/testimonials/model'

// ── Testimonials section (Testimonials module, ADR-048 D5) ────────────────────
// Presentation only. The testimonials arrive hydrated (hydrateTestimonialsSection
// via hydrateSections) — published, with permission, each in one coherent
// language. No testimonial → no section. No structured data of any kind (D7).

interface Props {
  section: TestimonialsSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

export function TestimonialsSection({ section, surface, designSystem, locale }: Props) {
  const items = section.testimonialItems ?? []
  if (items.length === 0) return null

  const { eyebrow, title, headlineAccent, subtitle } = section
  const msgs = getTestimonialMessages(locale)
  const cards = items.map((t) => toCardView(t, section, msgs, locale))
  const layout = section.layout === 'grid' ? 'grid' : DEFAULT_TESTIMONIAL_LAYOUT
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for the entrance, durationFast for the window
  const m = designSystem?.motion
  const entranceDuration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const fastDuration = m?.durationFast !== undefined ? m.durationFast / 1000 : 0.15
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <SlideUp duration={entranceDuration} ease={ease} delay={0}>
        {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" className="mb-4" />}
        {title && (
          <h2
            className={`${subtitle ? 'mb-4' : 'mb-12'} [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]`}
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
          >
            {renderHeadline(title, headlineAccent)}
          </h2>
        )}
        {subtitle && (
          <p className={multiline('mb-12 max-w-[680px] text-base leading-relaxed')} style={{ color: 'var(--color-text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </SlideUp>

      <SlideUp duration={entranceDuration} ease={ease} delay={0.1}>
        <TestimonialsView
          items={cards}
          layout={layout}
          duration={fastDuration}
          ease={ease}
          labels={{
            readMore: msgs.readMore,
            close: msgs.close,
            previous: msgs.previous,
            next: msgs.next,
            carouselLabel: msgs.carouselLabel,
            dialogFallback: msgs.dialogFallback,
            slideLabels: cards.map((_, i) => formatTestimonialMessage(msgs.slideLabel, { n: i + 1, total: cards.length })),
          }}
        />
        {section.showDisclosure !== false && (
          <p className="mt-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {msgs.disclosure}
          </p>
        )}
      </SlideUp>
    </SectionContainer>
  )
}
