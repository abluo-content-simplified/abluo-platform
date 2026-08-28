'use client'

/**
 * StepsSection
 *
 * Reusable platform section for a "how it works" / process flow: an optional
 * header block, a responsive row of numbered steps separated by hairline
 * rules, and an optional closing statement bar with a CTA.
 *
 * Conventions (shared section contract):
 *   - ({ section, surface, designSystem }) wrapped in <SectionContainer>
 *   - All colours, radii and fonts come from CSS custom properties. No
 *     JS-resolved colour values ever appear here.
 *   - Motion tokens are read off designSystem and fed to the shared SlideUp
 *     wrapper, with a per-item stagger.
 *   - Localized fields arrive already resolved to strings by the GROQ
 *     projection — this component never sees a locale object.
 *
 * Two deliberate departures from the design this is modelled on:
 *   1. The step ordinals stay visible at every breakpoint. They are the
 *      element that makes the sequence readable, and mobile is where a
 *      stacked layout needs that ordering cue most.
 *   2. The grid uses real breakpoints (1 → 2 → 3 columns) instead of
 *      `auto-fit, minmax(280px, 1fr)`. auto-fit cannot tell the component
 *      how many columns it produced, so the "no right border on the last in
 *      a row" and connector-node rules were wrong at every width except the
 *      one the original was designed at. With a known column count both are
 *      exact — see buildStepsGridCss().
 */

import { useId } from 'react'
import { useParams } from 'next/navigation'
import type { StepsSection as StepsSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { Icon } from '@/components/icons'

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Two-digit ordinal for a zero-based index: 0 → "01". */
export function stepOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/**
 * Widest column count the grid should ever use.
 * Never more columns than there are steps — a lone step in a 3-col grid
 * would sit in a third of the width with two empty cells beside it.
 */
export function resolveStepColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1
  if (count === 2) return 2
  return 3
}

/**
 * Build the scoped stylesheet for the steps grid.
 *
 * Emits, for a given scope class:
 *   - column counts per breakpoint (1 → 2 at 640px → up to 3 at 1024px)
 *   - a hairline top rule on every cell, and a right rule on every cell that
 *     is NOT last in its row at that breakpoint
 *   - visibility of the connector node, which exists only between two cells
 *     that sit side by side in the same row
 *
 * Written as a string (rather than Tailwind classes) because the nth-child
 * rules depend on the runtime step count, which Tailwind cannot express.
 */
export function buildStepsGridCss(scope: string, count: number): string {
  const maxCols = resolveStepColumns(count)
  const s = `.${scope}`

  // Mobile: single column. Top rule only, no right rule, no connectors.
  let css =
    `${s}{display:grid;grid-template-columns:1fr;gap:0;}` +
    `${s}>*{position:relative;border-top:1px solid var(--color-border);}` +
    `${s} .steps-connector{display:none;}`

  const columnRules = (cols: number) => {
    if (cols < 2) return ''
    return (
      `${s}{grid-template-columns:repeat(${cols},minmax(0,1fr));}` +
      // Every cell gets a right rule + connector...
      `${s}>*{border-right:1px solid var(--color-border);}` +
      `${s} .steps-connector{display:flex;}` +
      // ...except the last in each row, and the last overall.
      `${s}>*:nth-child(${cols}n){border-right:none;}` +
      `${s}>*:nth-child(${cols}n) .steps-connector{display:none;}` +
      `${s}>*:last-child{border-right:none;}` +
      `${s}>*:last-child .steps-connector{display:none;}`
    )
  }

  if (maxCols >= 2) css += `@media (min-width:640px){${columnRules(2)}}`
  if (maxCols >= 3) css += `@media (min-width:1024px){${columnRules(3)}}`

  return css
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function ClosingCta({ cta }: { cta: NonNullable<StepsSectionType['closingCta']> }) {
  // tenantId and locale are URL params — not stored in Sanity.
  const params = useParams()
  const locale = params?.locale as string | undefined
  const tenantId = params?.tenant as string | undefined

  let resolved = resolveCta(cta)
  if (resolved.type === 'link' && !resolved.external && locale && tenantId) {
    const slug = resolved.href.startsWith('/') ? resolved.href.slice(1) : resolved.href
    resolved = { ...resolved, href: `/${locale}/${tenantId}/${slug}` }
  }
  if (resolved.type === 'none') return null

  return (
    <CtaButton
      cta={resolved}
      className="inline-flex h-11 shrink-0 items-center gap-2 px-6 text-sm font-semibold tracking-wide transition-all duration-200 hover:opacity-90"
      style={{
        backgroundColor: 'var(--btn-primary-bg, var(--color-primary))',
        color: 'var(--btn-primary-text)',
        borderRadius: 'var(--radius-btn, var(--radius-md))',
      }}
    />
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  section: StepsSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function StepsSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, steps, closingText, closingCta } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Scope class for the generated grid CSS. useId is stable across
  // server/client render; ':' is not valid in a class name, so strip it.
  const scope = `steps-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const hasHeader = Boolean(eyebrow || title || intro)
  const stepCount = steps?.length ?? 0
  const hasClosing = Boolean(closingText || closingCta)

  return (
    <SectionContainer style={surfaceStyles}>
      {/* Header */}
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-14 md:mb-20">
          {eyebrow && (
            <p
              className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h2
              className="font-semibold tracking-tight"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'clamp(2rem, 4vw, 3.5rem)',
                lineHeight: 1.08,
                letterSpacing: '-0.03em',
                maxWidth: '18ch',
              }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p
              className="mt-5 text-base leading-relaxed"
              style={{
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-body)',
                maxWidth: '42ch',
              }}
            >
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {/* Steps */}
      {steps && stepCount > 0 && (
        <>
          <style dangerouslySetInnerHTML={{ __html: buildStepsGridCss(scope, stepCount) }} />
          <div className={scope}>
            {steps.map((step, index) => (
              <SlideUp
                key={step._key}
                duration={duration}
                ease={ease}
                delay={index * 0.05}
              >
                <div className="relative h-full px-0 py-8 sm:p-8 lg:p-10">
                  {/* Ordinal + optional icon — visible at every breakpoint */}
                  <div className="mb-6 flex items-center gap-3">
                    <span
                      className="text-[0.6875rem] font-bold"
                      style={{
                        color: 'var(--color-primary)',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '0.12em',
                      }}
                    >
                      {stepOrdinal(index)}
                    </span>
                    {step.icon && (
                      <span
                        className="inline-flex items-center justify-center"
                        style={{ color: 'var(--color-primary)' }}
                        aria-hidden="true"
                      >
                        <Icon name={step.icon} size={18} />
                      </span>
                    )}
                  </div>

                  {/* Connector node — sits on the rule between two side-by-side
                      cells. Shown/hidden entirely by buildStepsGridCss(). */}
                  <span
                    className="steps-connector absolute items-center justify-center"
                    aria-hidden="true"
                    style={{
                      top: '50%',
                      right: '-1.25rem',
                      transform: 'translateY(-50%)',
                      zIndex: 10,
                      width: '2.5rem',
                      height: '2.5rem',
                      backgroundColor: 'var(--color-surface, var(--color-section-surface1))',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-primary)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>

                  {step.title && (
                    <h3
                      className="mb-1.5 text-xl font-bold tracking-tight md:text-[1.375rem]"
                      style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {step.title}
                    </h3>
                  )}

                  {step.subtitle && (
                    <p
                      className="mb-4 text-xs"
                      style={{ color: 'var(--color-text-muted)', letterSpacing: '0.02em' }}
                    >
                      {step.subtitle}
                    </p>
                  )}

                  {step.description && (
                    <p
                      className="mb-7 text-[0.9375rem] leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
                    >
                      {step.description}
                    </p>
                  )}

                  {step.tags && step.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {step.tags.map((tag, tagIndex) => (
                        <span
                          key={`${step._key}-tag-${tagIndex}`}
                          className="px-2.5 py-1 text-[0.625rem] font-bold uppercase"
                          style={{
                            fontFamily: 'var(--font-heading)',
                            letterSpacing: '0.1em',
                            color: 'var(--color-text-muted)',
                            backgroundColor: 'var(--color-surface, var(--color-section-surface2))',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </SlideUp>
            ))}
          </div>
        </>
      )}

      {/* Closing statement */}
      {hasClosing && (
        <SlideUp
          duration={duration}
          ease={ease}
          delay={0.1}
          className="mt-14 md:mt-16"
        >
          <div
            className="flex flex-col items-start justify-between gap-6 pt-10 sm:flex-row sm:items-center sm:gap-8 lg:pt-12"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            {closingText && (
              <p
                className="font-bold tracking-tight"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'clamp(1.125rem, 2.5vw, 1.75rem)',
                  lineHeight: 1.25,
                  letterSpacing: '-0.02em',
                  maxWidth: '32ch',
                }}
              >
                {closingText}
              </p>
            )}
            {closingCta && <ClosingCta cta={closingCta} />}
          </div>
        </SlideUp>
      )}
    </SectionContainer>
  )
}
