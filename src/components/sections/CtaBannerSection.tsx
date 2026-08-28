'use client'

/**
 * CtaBannerSection
 *
 * Tall, centred closing call-to-action band. Reusable platform section —
 * available to every tenant regardless of installed modules.
 *
 * Why this exists alongside StatementSection: StatementSection is a centred
 * text block with no CTA at all, and its `alignment: 'center'` is silently
 * disabled the moment an image is present. This section is always centred,
 * always CTA-first (primary + secondary side by side), and adds the tall
 * band, the decorative wordmark, the glow, the divider and the footnote.
 *
 * Decorative layers (both `aria-hidden`, both optional):
 *   watermarkText → oversized outlined wordmark behind the content. Authored
 *                   per tenant; omit the field and no wordmark renders.
 *   showGlow      → soft centred radial glow derived from --color-primary.
 *
 * All colour comes from Design System CSS custom properties — never from
 * resolved JS colour values — so light/dark theme switching keeps working in
 * RSC contexts. Button fills use the --btn-* token pair, which the DS
 * authors with WCAG AA contrast between fill and text.
 */

import { useParams } from 'next/navigation'
import type { Cta, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { FadeIn } from '@/components/animation/FadeIn'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'

// ─── Section data shape ───────────────────────────────────────────────────────
// Mirrors the canonical `CtaBannerSection` interface being added to
// src/lib/sanity/types.ts by a parallel workstream (see
// /tmp/ctaBannerSection-spec.md). Declared locally so this file compiles
// before that lands; swap the local declaration for
//   import type { CtaBannerSection as CtaBannerSectionType } from '@/lib/sanity/types'
// once the union entry exists. The two are structurally identical, so the
// SectionRenderer `case` type-checks either way.
export interface CtaBannerSectionData {
  _type: 'ctaBannerSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ. Honours `\n` as a hard line break. */
  heading?: string
  /** Locale-resolved by GROQ */
  body?: string
  primaryCta?: Cta
  secondaryCta?: Cta
  /** Locale-resolved by GROQ */
  footnote?: string
  /** Locale-resolved by GROQ. Rendered in the accent colour after `footnote`. */
  footnoteAccent?: string
  /** Locale-resolved by GROQ. Oversized outlined wordmark behind the content. */
  watermarkText?: string
  /** Defaults to true. GROQ returns null for an unset boolean. */
  showGlow?: boolean | null
}

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

/**
 * Resolve the `showGlow` field to the CSS `background` for the glow layer.
 *
 * GROQ returns `null` — not `undefined` — for a boolean that was never set in
 * Sanity, which bypasses destructuring defaults. Every banner authored before
 * this field existed must still show the glow, so null and undefined both
 * resolve to "on"; only an explicit `false` turns it off.
 *
 * The glow is derived from the accent token via color-mix so it tracks each
 * tenant's brand colour and both themes without a hardcoded rgba().
 */
export function buildGlowBackground(showGlow: boolean | null | undefined): string | undefined {
  if (showGlow === false) return undefined
  return 'radial-gradient(ellipse at center, color-mix(in oklch, var(--color-primary) 9%, transparent) 0%, transparent 70%)'
}

/**
 * True when at least one CTA is present AND resolvable. resolveCta() returns
 * `{ type: 'none' }` for a half-filled CTA (action chosen, target still blank),
 * and CtaButton renders nothing for those — so without this check an
 * in-progress banner would render an empty flex row and its bottom margin.
 */
export function hasRenderableCta(
  primary: { type: string } | null,
  secondary: { type: string } | null
): boolean {
  return (primary !== null && primary.type !== 'none') || (secondary !== null && secondary.type !== 'none')
}

// ─── CTA row ──────────────────────────────────────────────────────────────────

function CtaRow({ section }: { section: CtaBannerSectionData }) {
  // tenantId and locale are URL params — not stored in Sanity. They're used
  // here to build the correct full path for internal page CTA links.
  const params = useParams()
  const locale = params.locale as string | undefined
  const tenantId = params.tenant as string | undefined

  function withTenantPrefix(resolved: ReturnType<typeof resolveCta>) {
    if (resolved.type !== 'link' || resolved.external || !locale || !tenantId) return resolved
    const slug = resolved.href.startsWith('/') ? resolved.href.slice(1) : resolved.href
    return { ...resolved, href: `/${locale}/${tenantId}/${slug}` }
  }

  const primaryCta = section.primaryCta ? withTenantPrefix(resolveCta(section.primaryCta)) : null
  const secondaryCta = section.secondaryCta ? withTenantPrefix(resolveCta(section.secondaryCta)) : null

  if (!hasRenderableCta(primaryCta, secondaryCta)) return null

  return (
    <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
      {primaryCta && primaryCta.type !== 'none' && (
        <CtaButton
          cta={primaryCta}
          className="inline-flex items-center gap-2 px-9 py-4 text-base font-semibold tracking-wide transition-all duration-200 hover:opacity-90"
          style={{
            backgroundColor: 'var(--btn-primary-bg)',
            color: 'var(--btn-primary-text)',
            borderRadius: 'var(--radius-btn)',
          }}
        />
      )}
      {secondaryCta && secondaryCta.type !== 'none' && (
        <CtaButton
          cta={secondaryCta}
          className="inline-flex items-center gap-2 px-9 py-4 text-base font-medium transition-all duration-150 hover:opacity-80"
          style={{
            backgroundColor: 'var(--btn-secondary-bg)',
            color: 'var(--btn-secondary-text)',
            borderRadius: 'var(--radius-btn)',
            border: '1.5px solid var(--color-border)',
          }}
        />
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  section: CtaBannerSectionData
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function CtaBannerSection({ section, surface, designSystem }: Props) {
  const { eyebrow, heading, body, footnote, footnoteAccent, watermarkText, showGlow } = section

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const glowBackground = buildGlowBackground(showGlow)
  const hasFootnote = Boolean(footnote || footnoteAccent)

  return (
    <SectionContainer style={surfaceStyles}>
      {/*
        The band's extra height lives here rather than on SectionContainer,
        which owns one padding scale for every section. Combined with the
        container's own vertical padding this lands at ~10rem on desktop.
        `overflow-hidden` clips the oversized wordmark; `relative` is the
        positioning context for both decorative layers.
      */}
      <div className="relative isolate overflow-hidden py-6 md:py-8 lg:py-6">
        {/* Decorative wordmark — outline only, behind everything, never read out */}
        {watermarkText && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap font-extrabold"
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(6rem, 20vw, 20rem)',
              letterSpacing: '-0.05em',
              lineHeight: 1,
              color: 'transparent',
              WebkitTextStroke: '1px var(--color-border)',
              opacity: 0.4,
            }}
          >
            {watermarkText}
          </div>
        )}

        {/* Soft accent glow */}
        {glowBackground && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[60%] w-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ background: glowBackground }}
          />
        )}

        <div className="relative mx-auto flex flex-col items-center text-center">
          <SlideUp duration={duration} ease={ease} delay={0} className="w-full">
            {eyebrow && (
              <p
                className="mb-6 text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}
              >
                {eyebrow}
              </p>
            )}

            {heading && (
              <h2
                className="mx-auto font-extrabold"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'clamp(2.5rem, 6vw, 5.5rem)',
                  letterSpacing: '-0.04em',
                  lineHeight: 1.0,
                  // Authors type real line breaks in the Studio text field;
                  // pre-line turns each newline into a hard break without any
                  // string splitting or markup in the content.
                  whiteSpace: 'pre-line',
                }}
              >
                {heading}
              </h2>
            )}

            {body && (
              <p
                className="mx-auto mt-6 text-lg"
                style={{
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-body)',
                  lineHeight: 1.7,
                  maxWidth: '38ch',
                }}
              >
                {body}
              </p>
            )}
          </SlideUp>

          <SlideUp duration={duration} ease={ease} delay={0.12} className="w-full">
            <CtaRow section={section} />
          </SlideUp>

          {hasFootnote && (
            <FadeIn duration={duration} ease={ease} delay={0.2} className="w-full">
              <div
                aria-hidden="true"
                className="mx-auto mt-20 h-px w-full max-w-[560px]"
                style={{ backgroundColor: 'var(--color-border)' }}
              />
              <p
                className="mt-12 text-base font-semibold"
                style={{
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-heading)',
                  letterSpacing: '0.02em',
                }}
              >
                {footnote}
                {/*
                  The accent tail is its own authored field on purpose. The
                  design this is derived from split the footnote on the literal
                  English word "Stronger" to colour its tail — that breaks the
                  moment the sentence is translated. Authors decide the split
                  here, in whatever language they are writing.
                */}
                {footnoteAccent && (
                  <span style={{ color: 'var(--color-primary)' }}>
                    {footnote ? ' ' : ''}
                    {footnoteAccent}
                  </span>
                )}
              </p>
            </FadeIn>
          )}
        </div>
      </div>
    </SectionContainer>
  )
}
