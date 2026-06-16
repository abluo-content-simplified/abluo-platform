import type { HeroSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'

interface Props {
  section: HeroSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function HeroSection({ section, surface, designSystem }: Props) {
  const { eyebrow, headline, subheadline, ctaLabel, ctaHref } = section

  const headlineLines = headline?.split('\n') ?? []
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlower for hero entrance; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Stagger offsets — eyebrow shifts subsequent elements by +0.1s
  const d1 = eyebrow ? 0.1 : 0
  const d2 = eyebrow ? 0.2 : 0.1
  const d3 = eyebrow ? 0.3 : 0.2
  const d4 = eyebrow ? 0.4 : 0.3

  return (
    <section
      className="relative flex min-h-[88vh] flex-col justify-center px-6 py-24 md:px-16 lg:px-24"
      style={surfaceStyles}
    >
      {/* Decorative left border accent */}
      <div
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: 'var(--color-primary)' }}
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-5xl">
        {/* Eyebrow */}
        {eyebrow && (
          <SlideUp duration={duration} ease={ease} delay={0} className="mb-8">
            <p
              className="text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          </SlideUp>
        )}

        {/* Headline */}
        <SlideUp duration={duration} ease={ease} delay={d1} className="mb-8">
          <h1
            className="text-5xl font-semibold leading-[1.1] tracking-tight md:text-6xl lg:text-7xl"
            style={{
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-heading)',
            }}
          >
            {headlineLines.length > 1 ? (
              headlineLines.map((line, i) => (
                <span key={i} className="block">{line}</span>
              ))
            ) : (
              headline
            )}
          </h1>
        </SlideUp>

        {/* Divider */}
        <SlideUp duration={duration} ease={ease} delay={d2} className="mb-8">
          <div
            className="h-[1px] w-16"
            style={{ backgroundColor: 'var(--color-border)' }}
          />
        </SlideUp>

        {/* Subheadline */}
        {subheadline && (
          <SlideUp duration={duration} ease={ease} delay={d3} className="mb-12">
            <p
              className="max-w-xl text-lg leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {subheadline}
            </p>
          </SlideUp>
        )}

        {/* CTA */}
        {ctaLabel && (
          <SlideUp duration={duration} ease={ease} delay={d4}>
            <a
              href={ctaHref ?? '#'}
              className="inline-flex h-12 items-center gap-2 px-8 text-sm font-medium tracking-wide transition-opacity hover:opacity-85"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-background)',
              }}
            >
              {ctaLabel}
              <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
            </a>
          </SlideUp>
        )}
      </div>

      {/* Bottom scroll indicator */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div
          className="h-8 w-[1px] animate-pulse"
          style={{ backgroundColor: 'var(--color-border)' }}
        />
      </div>
    </section>
  )
}
