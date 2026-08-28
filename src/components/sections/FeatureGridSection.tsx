import type { CSSProperties } from 'react'
import type { FeatureGridSection as FeatureGridSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Icon } from '@/components/icons'

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The canonical `FeatureCard` / `FeatureGridSection` interfaces now live in
// src/lib/sanity/types.ts (they landed with the schema/projection registration),
// so the local duplicates that kept this file compiling standalone are gone.
// The two helper unions below stay here — they are this component's own
// vocabulary, and the canonical interface spells the same members inline.

export type FeatureGridVariant = 'icon' | 'number' | 'none'
export type FeatureGridColumns = 'auto' | '2' | '3' | '4'

interface Props {
  section: FeatureGridSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Normalise the `variant` field. GROQ returns `null` (not `undefined`) for a
 * field that was never set, so a destructuring default is not enough — every
 * feature grid saved before this field existed must fall back to 'icon'.
 */
export function resolveFeatureGridVariant(
  variant: string | null | undefined,
): FeatureGridVariant {
  return variant === 'number' || variant === 'none' ? variant : 'icon'
}

/**
 * Grid track configuration for a `columns` value.
 *
 * Fixed counts resolve to Tailwind classes so they keep real breakpoints;
 * 'auto' has no Tailwind equivalent and resolves to an inline auto-fit track
 * (the hairline grid from the source designs: minmax(280px, 1fr)).
 */
export function resolveFeatureGridColumns(
  columns: string | null | undefined,
): { className: string; style?: CSSProperties } {
  switch (columns) {
    case '2':
      return { className: 'grid-cols-1 sm:grid-cols-2' }
    case '3':
      return { className: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }
    case '4':
      return { className: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' }
    case 'auto':
    default:
      return {
        className: '',
        style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
      }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * FeatureGridSection — hairline card grid for "why us" pillars, partner
 * advantages, channel line-ups and any other short feature list.
 *
 * One component, three looks, chosen by `variant`:
 *   'icon'   — 48px bordered icon box in the brand colour above each card
 *   'number' — large two-digit ordinal watermark in the top-right corner
 *   'none'   — no marker; title and copy only
 *
 * The grid itself is a 1px gap over a border-coloured parent, so the gutters
 * read as hairlines between cards rather than as space.
 */
export function FeatureGridSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, chips, features } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const variant = resolveFeatureGridVariant(section.variant)
  const grid = resolveFeatureGridColumns(section.columns)

  const hasChips = Boolean(chips && chips.length > 0)
  const hasAside = Boolean(intro || hasChips)
  const hasHeader = Boolean(eyebrow || title || hasAside)

  // Header improvement over the source design: the title/intro split is a real
  // responsive grid (stacked on mobile and tablet, two columns from lg up)
  // instead of a hard-coded 1fr 1fr that squashed the copy on small screens.
  const headerClass = hasAside
    ? 'mb-16 grid items-start gap-8 lg:grid-cols-2 lg:gap-16'
    : 'mb-16 max-w-2xl'

  return (
    <SectionContainer style={surfaceStyles}>
      {/* Header */}
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className={headerClass}>
          <div>
            {eyebrow && (
              <p
                className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2
                className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  whiteSpace: 'pre-line',
                }}
              >
                {title}
              </h2>
            )}
          </div>

          {hasAside && (
            <div>
              {intro && (
                <p
                  className="text-base leading-relaxed"
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'var(--font-body)',
                    maxWidth: '52ch',
                  }}
                >
                  {intro}
                </p>
              )}
              {hasChips && (
                <div className={`flex flex-wrap gap-2 ${intro ? 'mt-8' : ''}`}>
                  {chips!.map((chip) => (
                    <span
                      key={chip}
                      className="px-3 py-[0.4rem] text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
                      style={{
                        color: 'var(--color-text-muted)',
                        fontFamily: 'var(--font-heading)',
                        backgroundColor: 'var(--color-background-alt, var(--color-surface))',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm, 0.25rem)',
                      }}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </SlideUp>
      )}

      {/* Hairline card grid — 1px gaps over a border-coloured parent */}
      {features && features.length > 0 && (
        <div
          className={`grid gap-px ${grid.className}`}
          style={{
            ...grid.style,
            backgroundColor: 'var(--color-border)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            gridAutoRows: '1fr',
          }}
        >
          {features.map((feature, index) => (
            <SlideUp
              key={feature._key}
              duration={duration}
              ease={ease}
              delay={index * 0.05}
              className="h-full"
            >
              <div
                className="relative flex h-full flex-col bg-[var(--color-surface)] p-8 transition-colors duration-300 hover:bg-[var(--color-background-alt)] md:p-10"
              >
                {/* Marker — icon box, ordinal watermark, or nothing */}
                {variant === 'icon' && feature.icon && (
                  <div
                    className="mb-7 flex h-12 w-12 shrink-0 items-center justify-center"
                    style={{
                      color: 'var(--color-primary)',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background-alt, var(--color-surface))',
                      borderRadius: 'var(--radius-sm, 0.25rem)',
                    }}
                    aria-hidden="true"
                  >
                    <Icon name={feature.icon} size={24} />
                  </div>
                )}

                {variant === 'number' && (
                  <span
                    className="pointer-events-none absolute right-7 top-6 font-semibold leading-none"
                    style={{
                      color: 'var(--color-border)',
                      fontFamily: 'var(--font-heading)',
                      fontSize: '3.5rem',
                      letterSpacing: '-0.05em',
                      userSelect: 'none',
                    }}
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                )}

                {/* Kicker */}
                {feature.kicker && (
                  <p
                    className="relative z-[1] mb-[0.875rem] text-[0.625rem] font-bold uppercase tracking-[0.14em]"
                    style={{
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >
                    {feature.kicker}
                  </p>
                )}

                {/* Title — honours literal line breaks authored in Studio */}
                {feature.title && (
                  <h3
                    className="relative z-[1] mb-5 text-[1.625rem] font-semibold leading-[1.1] tracking-tight"
                    style={{
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-heading)',
                      whiteSpace: 'pre-line',
                      // Keeps the ordinal watermark clear of the headline
                      maxWidth: variant === 'number' ? '18ch' : undefined,
                    }}
                  >
                    {feature.title}
                  </h3>
                )}

                {/* Description */}
                {feature.description && (
                  <p
                    className="relative z-[1] text-[0.9375rem] leading-relaxed"
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    {feature.description}
                  </p>
                )}

                {/* Bullets — hairline-separated rows with a brand dot */}
                {feature.bullets && feature.bullets.length > 0 && (
                  <ul className="relative z-[1] mt-8 list-none p-0">
                    {feature.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="flex items-center gap-3 pt-[0.625rem] text-sm"
                        style={{
                          color: 'var(--color-text-muted)',
                          fontFamily: 'var(--font-body)',
                          borderTop: '1px solid var(--color-border)',
                        }}
                      >
                        <span
                          className="h-1 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: 'var(--color-primary)' }}
                          aria-hidden="true"
                        />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SlideUp>
          ))}
        </div>
      )}
    </SectionContainer>
  )
}
