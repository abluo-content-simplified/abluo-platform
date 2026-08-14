'use client'

import { useRef, useEffect, useCallback } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  animate,
  useReducedMotion,
  useScroll,
} from 'motion/react'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import type { HeroLensSection as HeroLensSectionType, DesignSystem } from '@/lib/sanity/types'
import { SlideUp } from '@/components/animation/SlideUp'
import { imageUrl } from '@/lib/sanity/image'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { useEarlyAccessSafe } from '@/components/forms/EarlyAccessContext'
import { useFormOverlaySafe } from '@/components/forms/FormOverlayContext'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: HeroLensSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

// ── Composition overview ──────────────────────────────────────────────────────
//
// The section is an overflow:hidden canvas. Three layers:
//
//   Layer 1 (z-1)  — Circular scene backdrop. Right-aligned, bleeds top/bottom.
//                     No mask, no fade — clean circular edge.
//                     TWO independent motions:
//                       A) Image inside the circle moves 20px with mouse (primary)
//                       B) Circle mask moves 4px with mouse (20% of image, secondary)
//                     Image inside also carries the idle scene drift.
//
//   Layer 2 (z-3)  — Foreground PNG (hand + phone), bottom-anchored.
//                     Rendered exactly as uploaded. No float, no tilt.
//                     Moves 2px with mouse (10% of image — stays anchored).
//
//   Layer 3 (z-10) — Content, left-half on desktop.
//
// Mouse tracking on the full section for seamless parallax.

const SECTION_HEIGHT = 'clamp(640px, 84vh, 820px)'

// Image buffer: inner image extends this much beyond the circle clip on each side.
// Must exceed max inner movement (image 18px + idle 5px = 23px). 8% ≈ 43–72px. ✓
const IMAGE_BUFFER = '-8%'

export function HeroLensSection({ section, surface, designSystem }: Props) {
  const sectionRef = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion() ?? false
  const earlyAccess = useEarlyAccessSafe()
  const formOverlay = useFormOverlaySafe()

  // ── Mouse tracking ─────────────────────────────────────────────────────────
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)

  // ── Springs — two different speeds ────────────────────────────────────────
  //
  // Circle spring: very slow, atmospheric — stiffness 42, mass 1.3
  //   The scene feels weighty and cinematic.
  //
  // Foreground spring: noticeably faster — stiffness 90, mass 0.8
  //   Without a snappier response the ±8px foreground movement is imperceptible
  //   through the slow circle spring. The hand needs to respond fast enough to
  //   be seen, while still feeling smooth (not snappy/elastic).

  const circleSpring = { stiffness: 42, damping: 17, mass: 1.3 }
  const smoothX = useSpring(rawX, circleSpring)
  const smoothY = useSpring(rawY, circleSpring)

  const fgSpring = { stiffness: 90, damping: 22, mass: 0.8 }
  const fgSmoothX = useSpring(rawX, fgSpring)
  const fgSmoothY = useSpring(rawY, fgSpring)

  // ── Circle: two independent motions ───────────────────────────────────────
  //
  // A) Image inside the circle — PRIMARY motion
  //    Absolute screen movement: ±46px x, ±30px y
  //
  // B) Mask (the circle itself) — SECONDARY motion
  //    ±28px — 3% of circle diameter, clearly visible as the lens shifts.
  //    (Previous ±8px = 1% of diameter = invisible.)
  //
  // User sees: mask moves ±28px, image moves ±46px on screen.
  // Implementation: mask carries ±28px, inner carries ±18px relative to mask.
  // Net image on screen: 28 + 18 = 46px. ✓

  const maskX = useTransform(smoothX, [-0.5, 0.5], [-28, 28])
  const maskY = useTransform(smoothY, [-0.5, 0.5], [-18, 18])

  // Image relative to mask (18px relative so absolute = 28 + 18 = 46px)
  const imageInnerX = useTransform(smoothX, [-0.5, 0.5], [-18, 18])
  const imageInnerY = useTransform(smoothY, [-0.5, 0.5], [-12, 12])

  // ── Foreground: faster spring, ±12px mouse parallax + float ───────────────
  // Uses fgSmoothX/Y (faster spring) so the hand responds quickly enough to see.
  const fgX = useTransform(fgSmoothX, [-0.5, 0.5], [-12, 12])
  const fgY = useTransform(fgSmoothY, [-0.5, 0.5], [-8, 8])

  // ── Idle animations ────────────────────────────────────────────────────────
  // idleX/Y: image inside circle drifts slowly (scene feels alive)
  // floatY:  foreground hand gently bobs up/down (subtle, constant)
  const idleX = useMotionValue(0)
  const idleY = useMotionValue(0)
  const floatY = useMotionValue(0)

  useEffect(() => {
    if (reducedMotion) return

    const a1 = animate(idleX, [-5, 5, -5], { duration: 14, repeat: Infinity, ease: 'easeInOut' })
    const a2 = animate(idleY, [-3, 3, -3], { duration: 11, repeat: Infinity, ease: 'easeInOut' })
    // Foreground float: gentle, slow vertical bob — ±6px over 5s
    const a3 = animate(floatY, [0, -6, 0], { duration: 5, repeat: Infinity, ease: 'easeInOut' })

    return () => { a1.stop(); a2.stop(); a3.stop() }
  }, [reducedMotion, idleX, idleY, floatY])

  // ── Scroll — circle only ───────────────────────────────────────────────────
  const { scrollY } = useScroll()
  const circleScrollY = useTransform(scrollY, [0, 600], [0, -35])

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (reducedMotion || !sectionRef.current) return
      const rect = sectionRef.current.getBoundingClientRect()
      rawX.set((e.clientX - rect.left) / rect.width - 0.5)
      rawY.set((e.clientY - rect.top) / rect.height - 0.5)
    },
    [reducedMotion, rawX, rawY]
  )

  const handleMouseLeave = useCallback(() => {
    rawX.set(0)
    rawY.set(0)
  }, [rawX, rawY])

  // ── DS motion tokens ───────────────────────────────────────────────────────
  const m = designSystem?.motion
  const duration = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.8
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const bgUrl = imageUrl(section.backgroundImage, 1600)
  const fgUrl = imageUrl(section.foregroundImage, 1400)

  const { eyebrow, title, subtitle, ctas } = section
  const [primaryCta, secondaryCta] = (ctas ?? []).map(resolveCta)

  // Bridge form CTAs to the correct overlay.
  //
  // Preferred path: the CTA points at a formDefinition, so its stable formId
  // opens the generic form overlay — the same route NavClient uses. This is
  // what every CTA will use once the legacy `form` type is gone.
  //
  // Fallback path: the CTA still points at a legacy `form` document, which the
  // code never rendered — it read one field, inquiryType, and used it to decide
  // which modal to open. Keeping that branch is what lets this ship before the
  // content is repointed; without it, every legacy CTA would go dead the moment
  // this deploys. Delete the branch once no cta references a `form`.
  function makeFormHandler(cta: ReturnType<typeof resolveCta> | undefined): (() => void) | undefined {
    if (!cta || cta.type !== 'form') return undefined

    if (cta.formDefinitionId && formOverlay) {
      const formId = cta.formDefinitionId
      return () => formOverlay.open({
        formId,
        source: {
          source: 'header_cta',
          cta_internal_name: cta.internalName ?? null,
          cta_label_snapshot: cta.label ?? null,
        },
      })
    }

    if (cta.formInquiryType === 'earlyAccess') {
      return () => earlyAccess?.open({
        source: 'header_cta',
        ctaInternalName: cta.internalName,
        ctaLabelSnapshot: cta.label,
      })
    }
    return undefined
  }

  const d0 = 0
  const d1 = eyebrow ? 0.1 : 0
  const d2 = d1 + 0.1
  const d3 = d2 + 0.1
  const d4 = d3 + 0.1

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden"
      style={{ ...surfaceStyles, minHeight: SECTION_HEIGHT }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Subtle grain texture */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
          opacity: 0.35,
          zIndex: 0,
        }}
        aria-hidden="true"
      />

      {/* ════════════════════════════════════════════════════════════════════
          LAYER 1 — Circular scene backdrop
          ────────────────────────────────────────────────────────────────────
          Right-aligned, centered vertically. Bleeds top + bottom.
          No fade, no mask on the image — clean circular edge.

          Motion architecture:
            Outer (scroll):  whole circle group parallaxes up on scroll
            Mask (mouse B):  circle moves ±4px — subtle lens shift
            Inner (mouse A): image moves ±16px relative to mask (20px absolute)
            Idle (scene):    image drifts ±5px on a slow 11–14s loop
          ════════════════════════════════════════════════════════════════════ */}
      <div
        className="pointer-events-none absolute"
        style={{ right: '-4%', top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        aria-hidden="true"
      >
        {/* Scroll parallax — whole circle group */}
        <motion.div style={{ y: reducedMotion ? 0 : circleScrollY }}>

          {/* B) Circle mask — moves slightly (±4px) */}
          <motion.div
            style={{
              // position:relative makes this the containing block for the absolute child
              position: 'relative',
              width: 'clamp(540px, 62vw, 900px)',
              height: 'clamp(540px, 62vw, 900px)',
              borderRadius: '50%',
              overflow: 'hidden',
              x: reducedMotion ? 0 : maskX,
              y: reducedMotion ? 0 : maskY,
            }}
          >
            {/* Oversized image wrapper — provides buffer so inner motion never shows
                the section background through the circle edge.
                7% each side ≈ 38–63px buffer, well above the ±21px max offset. */}
            <div
              style={{
                position: 'absolute',
                top: IMAGE_BUFFER,
                right: IMAGE_BUFFER,
                bottom: IMAGE_BUFFER,
                left: IMAGE_BUFFER,
              }}
            >
              {/* A) Image inner mouse motion — primary (±16px relative to mask) */}
              <motion.div
                className="absolute inset-0"
                style={{
                  x: reducedMotion ? 0 : imageInnerX,
                  y: reducedMotion ? 0 : imageInnerY,
                }}
              >
                {/* Idle scene drift — image inside circle drifts slowly */}
                <motion.div
                  className="absolute inset-0"
                  style={{
                    x: reducedMotion ? 0 : idleX,
                    y: reducedMotion ? 0 : idleY,
                  }}
                >
                  {bgUrl ? (
                    <img
                      src={bgUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{
                        background:
                          'radial-gradient(circle at 40% 46%, color-mix(in srgb, var(--color-primary) 70%, white 30%), color-mix(in srgb, var(--color-primary) 15%, black 85%))',
                        opacity: 0.22,
                      }}
                    />
                  )}
                </motion.div>
              </motion.div>
            </div>
          </motion.div>

        </motion.div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          LAYER 2 — Foreground: hand + phone PNG, exactly as uploaded
          ────────────────────────────────────────────────────────────────────
          Bottom-anchored. Arm disappears below the section edge.
          Mouse parallax: ±12px (faster spring — clearly perceptible).
          Float: gentle ±6px vertical bob on a 5s loop.
          ════════════════════════════════════════════════════════════════════ */}
      {fgUrl && (
        <div
          className="pointer-events-none absolute bottom-0 flex items-end justify-center"
          style={{ left: 'clamp(0px, 40%, 46%)', right: 0, zIndex: 3 }}
          aria-hidden="true"
        >
          {/* Mouse parallax */}
          <motion.div style={{ x: reducedMotion ? 0 : fgX, y: reducedMotion ? 0 : fgY }}>
            {/* Vertical float — gentle idle bob */}
            <motion.div style={{ y: reducedMotion ? 0 : floatY }}>
              <img
                src={fgUrl}
                alt=""
                aria-hidden="true"
                className="h-auto w-auto select-none"
                style={{
                  width: 'clamp(420px, 56vw, 920px)',
                  objectFit: 'contain',
                  transform: 'translateY(6%)',
                }}
                draggable={false}
              />
            </motion.div>
          </motion.div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          LAYER 3 — Content
          ════════════════════════════════════════════════════════════════════ */}
      <div
        className="relative mx-auto flex w-full max-w-7xl flex-col justify-center px-6 py-24 md:px-12 lg:px-20 xl:px-28"
        style={{ minHeight: SECTION_HEIGHT, zIndex: 10 }}
      >
        <div className="w-full lg:max-w-[50%]">

          {eyebrow && (
            <SlideUp duration={duration} ease={ease} delay={d0} className="mb-6">
              <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} />
            </SlideUp>
          )}

          {title && (
            <SlideUp duration={duration} ease={ease} delay={d1} className="mb-6">
              <h1
                className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl xl:text-6xl"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {title.split('\n').map((line, i) => (
                  <span key={i} className="block">{line}</span>
                ))}
              </h1>
            </SlideUp>
          )}

          <SlideUp duration={duration} ease={ease} delay={d2} className="mb-6">
            <div className="h-[1px] w-12" style={{ backgroundColor: 'var(--color-primary)', opacity: 0.6 }} />
          </SlideUp>

          {subtitle && (
            <SlideUp duration={duration} ease={ease} delay={d3} className="mb-10">
              <p className="max-w-md text-lg leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {subtitle}
              </p>
            </SlideUp>
          )}

          {(primaryCta || secondaryCta) && (
            <SlideUp duration={duration} ease={ease} delay={d4}>
              <div className="flex flex-wrap items-center gap-4">
                {primaryCta && (
                  <CtaButton
                    cta={primaryCta}
                    onFormClick={makeFormHandler(primaryCta)}
                    className="inline-flex h-12 items-center gap-2.5 px-8 text-sm font-semibold tracking-wide transition-all duration-200 hover:opacity-90 hover:shadow-lg"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: '#fff',
                      borderRadius: 'var(--radius-md, 8px)',
                      boxShadow: '0 4px 24px -4px color-mix(in srgb, var(--color-primary) 60%, transparent)',
                    }}
                  >
                    {primaryCta.label}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </CtaButton>
                )}
                {secondaryCta && (
                  <CtaButton
                    cta={secondaryCta}
                    onFormClick={makeFormHandler(secondaryCta)}
                    className="inline-flex h-12 items-center gap-2 px-6 text-sm font-medium transition-opacity duration-150 hover:opacity-70"
                    style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}
                  />
                )}
              </div>
            </SlideUp>
          )}

        </div>
      </div>
    </section>
  )
}
