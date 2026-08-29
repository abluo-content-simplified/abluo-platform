import type { TreatmentsSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: TreatmentsSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function TreatmentsSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, treatments } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  return (
      <SectionContainer id={section.anchorId ?? 'trattamenti'} style={surfaceStyles}>
        {/* Header */}
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-16">
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
              className="mb-6 [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p
              className="max-w-2xl text-base leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {intro}
            </p>
          )}
          <div className="mt-8 h-[1px] w-12" style={{ backgroundColor: 'var(--color-border)' }} />
        </SlideUp>

        {/* Treatment rows */}
        {treatments && treatments.length > 0 && (
          <div className="grid gap-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            {treatments.map((treatment, index) => (
              <SlideUp
                key={treatment._key}
                duration={duration}
                ease={ease}
                delay={index * 0.05}
              >
                <div
                  className="group grid gap-6 py-10 md:grid-cols-[2rem_1fr_2fr] md:gap-12"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {/* Number */}
                  <span
                    className="hidden text-sm font-light md:block"
                    style={{ color: 'var(--color-border)' }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>

                  {/* Left: name + tagline */}
                  <div className="flex flex-col justify-start">
                    <h3
                      className="mb-2"
                      style={{ color: 'var(--color-text-primary)', fontSize: 'var(--font-size-h4, 1.125rem)', fontWeight: 'var(--font-weight-h4, 600)', lineHeight: 'var(--line-height-h4, 1.75rem)' }}
                    >
                      {treatment.name}
                    </h3>
                    {treatment.tagline && (
                      <p
                        className="text-sm font-medium italic"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {treatment.tagline}
                      </p>
                    )}
                  </div>

                  {/* Right: description */}
                  {treatment.description && (
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {treatment.description}
                    </p>
                  )}
                </div>
              </SlideUp>
            ))}
          </div>
        )}
      </SectionContainer>

  )
}
