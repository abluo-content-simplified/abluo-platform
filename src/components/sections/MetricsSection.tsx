import type { MetricsSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { MetricsRow } from '@/components/sections/MetricsRow'

interface Props {
  section: MetricsSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

/**
 * Metrics — figures that state a position, not a dashboard.
 *
 * Two presentations, chosen by `layout`:
 *
 *   'cards'  (default, unchanged) — bordered tiles on a filled surface. What
 *            every existing site renders; untouched by the addition below.
 *
 *   'rule'   — a single row divided by hairlines, no fill, no box. The figures
 *            carry themselves and the rules do the separating. This is the
 *            treatment a display-typography site wants: a box around a 100px
 *            numeral makes it look like a statistic in a report.
 *
 * The 'rule' row is a client component (MetricsRow) because it animates: the
 * dividers draw before the figures arrive, and that sequence has to observe the
 * viewport. 'cards' stays a server component, exactly as before.
 */
export function MetricsSection({ section, surface, designSystem }: Props) {
  const { eyebrow, headline, description, metrics } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasHeader = Boolean(eyebrow || headline || description)
  const count = metrics?.length ?? 0
  const isRule = section.layout === 'rule'

  const gridClass = (() => {
    if (count <= 2) return 'grid-cols-1 sm:grid-cols-2'
    if (count === 3) return 'grid-cols-1 sm:grid-cols-3'
    if (count === 4) return 'grid-cols-2 md:grid-cols-4'
    if (count <= 6) return 'grid-cols-2 md:grid-cols-3'
    return 'grid-cols-2 md:grid-cols-4'
  })()

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-16 max-w-2xl">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              weight="semibold"
              className="mb-5"
            />
          )}
          {headline && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.375)',
                letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
              }}
            >
              {headline}
            </h2>
          )}
          {description && (
            <p
              className="mt-5 text-base leading-relaxed"
              style={{
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-body)',
                maxWidth: '52ch',
              }}
            >
              {description}
            </p>
          )}
        </SlideUp>
      )}

      {metrics && metrics.length > 0 && (
        isRule ? (
          <MetricsRow metrics={metrics} />
        ) : (
          <div
            className={`grid gap-px ${gridClass}`}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              gridAutoRows: '1fr',
            }}
          >
            {metrics.map((metric, index) => (
              <SlideUp
                key={metric._key}
                duration={duration}
                ease={ease}
                delay={index * 0.06}
                className="h-full"
              >
                <div
                  className="flex h-full flex-col justify-between gap-6 p-8 md:p-10"
                  style={{ backgroundColor: 'var(--color-surface, var(--color-background))' }}
                >
                  <p
                    className="whitespace-nowrap font-semibold leading-none tracking-tight"
                    style={{
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-heading)',
                      fontSize: 'clamp(1.75rem, 3.5vw + 1rem, 3.5rem)',
                    }}
                  >
                    {metric.value}
                  </p>
                  <div className="flex flex-col gap-2">
                    {metric.label && (
                      <p
                        className="text-base font-medium leading-snug"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {metric.label}
                      </p>
                    )}
                    {metric.description && (
                      <p
                        className="text-xs leading-relaxed"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {metric.description}
                      </p>
                    )}
                  </div>
                </div>
              </SlideUp>
            ))}
          </div>
        )
      )}
    </SectionContainer>
  )
}
