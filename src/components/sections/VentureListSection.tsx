import type { VentureListSection, VentureItem, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { renderHeadline } from '@/lib/headline-accent'

interface Props {
  section: VentureListSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

/**
 * Venture list — one full-width row per venture, rule-separated.
 *
 * Not a card grid. Each row is a two-column split: everything descriptive on
 * the left, and on the right a status badge with the author's role beneath it.
 * The point of the form is that a reader scanning only the right-hand edge
 * still learns what state every venture is in.
 *
 * ── The badge ────────────────────────────────────────────────────────────────
 * Three states, and the colour for each comes from the DESIGN SYSTEM, never
 * from the content: `live` is the success token, `soon` is the accent, and
 * `dev` is deliberately unpainted — muted text inside the ordinary hairline —
 * because "in development" is the resting state and should not compete with
 * the two that carry news. A tenant whose design system sets no success colour
 * gets the accent for `live` too; that is a duller page, not a broken one.
 *
 * Status is a fixed enum rather than free text so the three treatments stay
 * three. `statusLabel` exists for the wording, which does need translating.
 */

export type VentureStatus = 'live' | 'soon' | 'dev'

/** GROQ returns null for an unset field; unset means the resting state. */
export function resolveVentureStatus(status: string | null | undefined): VentureStatus {
  return status === 'live' || status === 'soon' ? status : 'dev'
}

/** Fallback wording when the author has not supplied `statusLabel`. */
const DEFAULT_STATUS_LABEL: Record<VentureStatus, string> = {
  live: 'Live',
  soon: 'Coming soon',
  dev: 'In development',
}

/**
 * Badge colours per state.
 *
 * `color-mix` gives the tinted fill and hairline from the SAME token as the
 * text, so a design system that changes its accent gets a coherent badge for
 * free rather than one that keeps a stale wash behind new text. The fallback
 * chain on `--color-success` is what makes the success token optional.
 */
export function badgeStyle(status: VentureStatus) {
  const token =
    status === 'live'
      ? 'var(--color-success, var(--color-primary))'
      : status === 'soon'
        ? 'var(--color-primary)'
        : 'var(--color-text-muted)'

  return {
    color: token,
    backgroundColor: status === 'dev' ? 'transparent' : `color-mix(in srgb, ${token} 8%, transparent)`,
    border: `1px solid ${status === 'dev' ? 'var(--color-border)' : `color-mix(in srgb, ${token} 22%, transparent)`}`,
  }
}

export function VentureListSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, ventures } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasHeader = Boolean(eyebrow || title || intro)
  if (!ventures?.length && !hasHeader) return null

  // The intro and taglines speak in the "editorial voice". That voice only
  // exists when the design system declares a third face — a tenant with two
  // faces must not have its body copy silently italicised, so the italic is
  // conditional on the face being there, not assumed.
  const hasAccentFace = Boolean(designSystem?.typography?.accentFont)
  const accentVoice = {
    fontFamily: hasAccentFace ? 'var(--font-accent)' : 'var(--font-body)',
    fontStyle: hasAccentFace ? ('italic' as const) : ('normal' as const),
  }

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} className="mb-16">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              weight="semibold"
              className="mb-5"
            />
          )}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.15)',
                letterSpacing: 'var(--letter-spacing-h2, -0.02em)',
                textTransform: 'uppercase',
              }}
            >
              {renderHeadline(title, section.headlineAccent)}
            </h2>
          )}
          {intro && (
            <p
              className="mt-6"
              style={{
                ...accentVoice,
                fontWeight: 300,
                fontSize: 'clamp(1.25rem, 2vw, 1.75rem)',
                lineHeight: 1.5,
                color: 'var(--color-text-secondary)',
                maxWidth: '48ch',
              }}
            >
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {ventures && ventures.length > 0 && (
        <div className="flex flex-col">
          {ventures.map((v: VentureItem, index: number) => {
            const status = resolveVentureStatus(v.status)
            const label = v.statusLabel ?? DEFAULT_STATUS_LABEL[status]

            return (
              <SlideUp key={v._key} duration={duration} ease={ease} delay={index * 0.06}>
                <article
                  className="grid grid-cols-1 items-start gap-6 py-12 md:grid-cols-[1fr_auto] md:gap-12"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <div>
                    {v.kicker && (
                      <p
                        className="mb-4 text-[0.65rem] uppercase tracking-[0.25em]"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {v.kicker}
                      </p>
                    )}
                    {v.name && (
                      <h3
                        className="[--fs-h3:2rem] md:[--fs-h3:2.75rem]"
                        style={{
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-heading)',
                          fontSize: 'var(--font-size-h3, var(--fs-h3))',
                          fontWeight: 'var(--font-weight-h3, 700)',
                          lineHeight: 'var(--line-height-h3, 0.95)',
                          letterSpacing: 'var(--letter-spacing-h3, -0.01em)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {v.name}
                      </h3>
                    )}
                    {v.tagline && (
                      <p
                        className="mt-4 text-lg leading-relaxed"
                        style={{
                          ...accentVoice,
                          fontWeight: 300,
                          color: 'var(--color-text-secondary)',
                          maxWidth: '46ch',
                        }}
                      >
                        {v.tagline}
                      </p>
                    )}
                    {v.body && (
                      <p
                        className="mt-4 text-base"
                        style={{
                          color: 'var(--color-text-muted)',
                          lineHeight: 1.85,
                          maxWidth: '62ch',
                        }}
                      >
                        {v.body}
                      </p>
                    )}
                  </div>

                  {/* Right rail: state first, then what the author did on it. On
                      a narrow screen these sit side by side rather than stacking
                      to the right edge of nothing. */}
                  <div className="flex flex-row items-start gap-6 md:flex-col md:items-end md:gap-4 md:pt-1">
                    <span
                      className="inline-flex whitespace-nowrap px-3 py-[0.3rem] text-[0.65rem] uppercase tracking-[0.18em]"
                      style={badgeStyle(status)}
                    >
                      {label}
                    </span>
                    {v.role && (
                      <p
                        className="whitespace-pre-line text-[0.68rem] uppercase leading-relaxed tracking-[0.14em] md:text-right"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {v.role}
                      </p>
                    )}
                  </div>
                </article>
              </SlideUp>
            )
          })}
        </div>
      )}
    </SectionContainer>
  )
}
