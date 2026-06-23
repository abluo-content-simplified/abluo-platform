import type { MetricsSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'

interface Props {
  section: MetricsSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function MetricsSection({ section, surface, designSystem }: Props) {
  const { eyebrow, headline, description, metrics } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const hasHeader = Boolean(eyebrow || headline || description)
  const count = metrics?.length ?? 0

  // Grid column class based on metric count.
  // 2 → 2-col, 3 → 3-col, 4 → 4-col (wraps on mobile), etc.
  // We use a responsive approach: sm:grid-cols-2, then md based on count.
  const gridClass = (() => {
    if (count <= 2) return 'grid-cols-1 sm:grid-cols-2'
    if (count === 3) return 'grid-cols-1 sm:grid-cols-3'
    if (count === 4) return 'grid-cols-2 md:grid-cols-4'
    if (count <= 6) return 'grid-cols-2 md:grid-cols-3'
    return 'grid-cols-2 md:grid-cols-4'
  })()

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={surfaceStyles}
    >
      <div className="mx-auto w-full max-w-6xl">

        {/* Optional header */}
        {hasHeader && (
          <SlideUp duration={duration} ease={ease} delay={0} className="mb-16 max-w-2xl">
            {eyebrow && (
              <p
                className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {eyebrow}
              </p>
            )}
            {headline && (
              <h2
                className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
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

        {/* Metrics grid */}
        {metrics && metrics.length > 0 && (
          <div
            className={`grid gap-px ${gridClass}`}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 1rem)',
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
                  {/* Value — the hero element */}
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

                  {/* Label + description */}
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
        )}
      </div>
    </section>
  )
}
