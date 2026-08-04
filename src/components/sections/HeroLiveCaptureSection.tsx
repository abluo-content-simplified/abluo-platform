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
import type { HeroLiveCaptureSection as HeroLiveCaptureSectionType, DesignSystem } from '@/lib/sanity/types'
import { SlideUp } from '@/components/animation/SlideUp'
import { imageUrl } from '@/lib/sanity/image'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { useEarlyAccessSafe } from '@/components/forms/EarlyAccessContext'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: HeroLiveCaptureSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

// ── Livener streaming UI — rendered on the phone screen ──────────────────────

function LivenerPhoneUI({
  streamImageUrl,
  intensity,
}: {
  streamImageUrl?: string
  intensity: number
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[26px]" style={{ background: '#0a0a0a' }}>
      {/* Stream video area */}
      <div className="absolute inset-0">
        {streamImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streamImageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ opacity: 0.85 }}
          />
        ) : (
          /* Gradient stand-in */
          <div
            className="h-full w-full"
            style={{
              background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
            }}
          />
        )}
        {/* Gradient overlay for UI legibility */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.75) 100%)',
          }}
        />
      </div>

      {/* Status bar */}
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 pt-3">
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-body, system-ui)', letterSpacing: '0.05em' }}>
          9:41
        </span>
        <div style={{ width: 60, height: 16, background: 'rgba(0,0,0,0.85)', borderRadius: 8 }} />
        <div className="flex items-center gap-1">
          {/* Signal */}
          {[2, 3, 4].map((h) => (
            <div key={h} style={{ width: 2, height: h * 2, background: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
          ))}
          {/* WiFi */}
          <svg width="10" height="8" viewBox="0 0 10 8" style={{ marginLeft: 2 }}>
            <path d="M5 7L5 7" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 5.5C3.6 4.8 4.3 4.5 5 4.5s1.4.3 2 1" stroke="rgba(255,255,255,0.7)" strokeWidth="1" fill="none" strokeLinecap="round" />
            <path d="M1.5 3.5C2.5 2.2 3.7 1.5 5 1.5s2.5.7 3.5 2" stroke="rgba(255,255,255,0.7)" strokeWidth="1" fill="none" strokeLinecap="round" />
          </svg>
          {/* Battery */}
          <svg width="14" height="8" viewBox="0 0 14 8">
            <rect x="0.5" y="0.5" width="11" height="7" rx="1.5" stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" fill="none" />
            <rect x="1.5" y="1.5" width="7.5" height="5" rx="0.5" fill="rgba(255,255,255,0.7)" />
            <path d="M12 3v2" stroke="rgba(255,255,255,0.7)" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* LIVE badge + viewer count */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-4" style={{ top: 38 }}>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1"
          style={{ background: 'rgba(220, 38, 38, 0.9)', borderRadius: 6 }}
        >
          {/* Pulsing dot */}
          <div className="relative flex items-center justify-center">
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#fff',
                animation: 'livener-pulse 1.4s ease-in-out infinite',
              }}
            />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.08em', fontFamily: 'var(--font-body, system-ui)' }}>
            LIVE
          </span>
        </div>

        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ background: 'rgba(0,0,0,0.5)', borderRadius: 6, backdropFilter: 'blur(8px)' }}
        >
          {/* Eye icon */}
          <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
            <path d="M5 1C3 1 1.5 2.5 1 3.5C1.5 4.5 3 6 5 6C7 6 8.5 4.5 9 3.5C8.5 2.5 7 1 5 1Z" stroke="rgba(255,255,255,0.8)" strokeWidth="0.8" />
            <circle cx="5" cy="3.5" r="1.2" fill="rgba(255,255,255,0.8)" />
          </svg>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-body, system-ui)' }}>
            1.2k
          </span>
        </div>
      </div>

      {/* Center play area — subtle icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
            <path d="M2 1.5L12 8L2 14.5V1.5Z" fill="white" />
          </svg>
        </div>
      </div>

      {/* Chat messages — decorative */}
      <div
        className="absolute bottom-16 right-0 flex flex-col gap-1.5 pr-3"
        style={{ maxWidth: '70%' }}
      >
        {[
          { name: 'Sara', msg: '🔥 incredible', color: '#f97316' },
          { name: 'Luca', msg: 'go go go!!', color: '#22d3ee' },
          { name: 'Mia', msg: '❤️', color: '#a78bfa' },
        ].map((c, i) => (
          <div
            key={i}
            className="flex items-baseline gap-1"
            style={{ opacity: 0.7 + i * 0.1 }}
          >
            <span style={{ fontSize: 8, fontWeight: 700, color: c.color, fontFamily: 'var(--font-body, system-ui)', whiteSpace: 'nowrap' }}>
              {c.name}
            </span>
            <span style={{ fontSize: 8.5, color: '#fff', fontFamily: 'var(--font-body, system-ui)', whiteSpace: 'nowrap' }}>
              {c.msg}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom controls */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-around px-4 pb-4 pt-2"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}
      >
        {/* Heart */}
        <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg width="18" height="17" viewBox="0 0 18 17" fill="none">
            <path d="M9 15.5C9 15.5 1.5 10.5 1.5 5.5C1.5 3.3 3.3 1.5 5.5 1.5C7 1.5 8.3 2.3 9 3.5C9.7 2.3 11 1.5 12.5 1.5C14.7 1.5 16.5 3.3 16.5 5.5C16.5 10.5 9 15.5 9 15.5Z" stroke="white" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
          </svg>
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-body, system-ui)' }}>2.1k</span>
        </button>

        {/* Chat */}
        <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg width="18" height="17" viewBox="0 0 18 17" fill="none">
            <path d="M2 2.5H16V12.5H10.5L9 15L7.5 12.5H2V2.5Z" stroke="white" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
          </svg>
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-body, system-ui)' }}>Chat</span>
        </button>

        {/* Share */}
        <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
            <circle cx="13" cy="3" r="2" stroke="white" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
            <circle cx="3" cy="9" r="2" stroke="white" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
            <circle cx="13" cy="15" r="2" stroke="white" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
            <path d="M5 10.3L11 13.7M11 4.3L5 7.7" stroke="white" strokeWidth="1" />
          </svg>
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-body, system-ui)' }}>Share</span>
        </button>
      </div>

      <style>{`
        @keyframes livener-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}

// ── Phone device frame ────────────────────────────────────────────────────────

function PhoneFrame({
  children,
  width = 220,
}: {
  children: React.ReactNode
  width?: number
}) {
  const height = Math.round(width * 2.1)
  const radius = Math.round(width * 0.16)
  const bezel = Math.round(width * 0.04)

  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(145deg, #2a2a2a 0%, #111 60%, #222 100%)',
        padding: bezel,
        boxShadow: `
          0 0 0 1px rgba(255,255,255,0.07),
          0 30px 80px -10px rgba(0,0,0,0.7),
          0 10px 30px -5px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.08)
        `,
        position: 'relative',
      }}
    >
      {/* Screen */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: radius - bezel,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
      </div>

      {/* Side button */}
      <div
        style={{
          position: 'absolute',
          right: -3,
          top: '28%',
          width: 3,
          height: 40,
          background: 'linear-gradient(to right, #333, #222)',
          borderRadius: '0 2px 2px 0',
        }}
      />
      {/* Volume buttons */}
      {[18, 46].map((top) => (
        <div
          key={top}
          style={{
            position: 'absolute',
            left: -3,
            top: `${top}%`,
            width: 3,
            height: 28,
            background: 'linear-gradient(to left, #333, #222)',
            borderRadius: '2px 0 0 2px',
          }}
        />
      ))}
    </div>
  )
}

// ── Animated visual column ────────────────────────────────────────────────────

interface VisualColumnProps {
  section: HeroLiveCaptureSectionType
  designSystem: DesignSystem | null
  animationIntensity: number
}

function VisualColumn({ section, animationIntensity }: VisualColumnProps) {
  const shouldReduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Motion values ──────────────────────────────────────────────────────────
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const springConfig = { stiffness: 90, damping: 25, mass: 0.8 }
  const phoneRotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [7 * animationIntensity, -7 * animationIntensity]), springConfig)
  const phoneRotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-7 * animationIntensity, 7 * animationIntensity]), springConfig)

  // Circle moves opposite to phone at 25% intensity
  const circleX = useTransform(mouseX, [-0.5, 0.5], [8 * animationIntensity, -8 * animationIntensity])
  const circleY = useTransform(mouseY, [-0.5, 0.5], [5 * animationIntensity, -5 * animationIntensity])
  const smoothCircleX = useSpring(circleX, { stiffness: 50, damping: 20 })
  const smoothCircleY = useSpring(circleY, { stiffness: 50, damping: 20 })

  // Idle float
  const floatY = useMotionValue(0)
  const floatRotate = useMotionValue(-3)

  useEffect(() => {
    if (shouldReduceMotion) return

    const floatAnim = animate(floatY, [0, -14, 0], {
      duration: 4,
      repeat: Infinity,
      ease: [0.45, 0.05, 0.55, 0.95],
    })

    const rotateAnim = animate(floatRotate, [-3, -5, -3], {
      duration: 6,
      repeat: Infinity,
      ease: [0.45, 0.05, 0.55, 0.95],
    })

    return () => {
      floatAnim.stop()
      rotateAnim.stop()
    }
  }, [shouldReduceMotion, floatY, floatRotate])

  // Scroll interaction
  const { scrollY } = useScroll()
  const circleScrollY = useTransform(scrollY, [0, 600], [0, -60])
  const phoneScrollRotate = useTransform(scrollY, [0, 600], [0, 2])

  // Mouse handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (shouldReduceMotion || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      mouseX.set(x)
      mouseY.set(y)
    },
    [shouldReduceMotion, mouseX, mouseY]
  )

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0)
    mouseY.set(0)
  }, [mouseX, mouseY])

  // Images
  const bgImageUrl = imageUrl(section.backgroundImage, 900)
  const screenImageUrl = imageUrl(section.phoneScreenImage, 400) ?? bgImageUrl
  const circleSize = section.circleSize === 'lg' ? 480 : section.circleSize === 'sm' ? 320 : 400

  return (
    <div
      ref={containerRef}
      className="relative flex h-[580px] items-center justify-center lg:h-[640px]"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ perspective: 1000 }}
    >
      {/* ── Glow ambiance ── */}
      <div
        className="pointer-events-none absolute"
        style={{
          width: circleSize * 1.3,
          height: circleSize * 1.3,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--color-primary, #dc2626) 0%, transparent 70%)',
          opacity: 0.08,
          filter: 'blur(40px)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* ── Event circle — Layer 1 ── */}
      <motion.div
        className="pointer-events-none absolute"
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: '50%',
          overflow: 'hidden',
          x: smoothCircleX,
          y: useTransform(
            [smoothCircleY, circleScrollY] as const,
            ([y, s]: number[]) => y + s
          ),
          top: '50%',
          left: '50%',
          translateX: '-50%',
          translateY: '-50%',
        }}
      >
        {bgImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgImageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: 'linear-gradient(135deg, oklch(0.25 0.05 250) 0%, oklch(0.15 0.03 260) 100%)',
            }}
          />
        )}
        {/* Radial mask — fades edges to transparent */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '50%',
            background: 'radial-gradient(circle, transparent 50%, var(--color-background, #ffffff) 90%)',
            mixBlendMode: 'normal',
          }}
        />
        {/* Subtle dark overlay for contrast */}
        <div
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '50%' }}
        />
      </motion.div>

      {/* ── Phone — Layer 2 ── */}
      <motion.div
        style={{
          y: floatY,
          rotate: shouldReduceMotion ? -3 : floatRotate,
          rotateX: shouldReduceMotion ? 0 : phoneRotateX,
          rotateY: shouldReduceMotion ? 0 : phoneRotateY,
          rotateZ: useTransform(phoneScrollRotate, (v) => -3 + v),
          transformStyle: 'preserve-3d',
          zIndex: 10,
          position: 'relative',
        }}
      >
        <PhoneFrame width={220}>
          <LivenerPhoneUI
            streamImageUrl={screenImageUrl}
            intensity={animationIntensity}
          />
        </PhoneFrame>
      </motion.div>
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export function HeroLiveCaptureSection({ section, surface, designSystem }: Props) {
  const earlyAccess = useEarlyAccessSafe()
  const {
    eyebrow,
    title,
    subtitle,
    ctas,
  } = section
  const [primaryCta, secondaryCta] = (ctas ?? []).map(resolveCta)

  // Bridge form CTAs to the correct modal handler.
  // Currently only earlyAccess is wired. Future types will route via FormModalProvider.
  function makeFormHandler(cta: ReturnType<typeof resolveCta> | undefined): (() => void) | undefined {
    if (!cta || cta.type !== 'form') return undefined
    if (cta.formInquiryType === 'earlyAccess') {
      return () => earlyAccess?.open({
        source: 'header_cta',
        ctaInternalName: cta.internalName,
        ctaLabelSnapshot: cta.label,
      })
    }
    return undefined
  }

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.65
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Animation intensity — maps string to numeric multiplier
  const intensityMap: Record<string, number> = { subtle: 0.5, moderate: 1, expressive: 1.5 }
  const animationIntensity = intensityMap[section.animationIntensity ?? 'moderate'] ?? 1

  // Stagger offsets
  const d0 = 0
  const d1 = eyebrow ? 0.1 : 0
  const d2 = d1 + 0.1
  const d3 = d2 + 0.1
  const d4 = d3 + 0.1

  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:px-12 lg:px-20 xl:px-28"
      style={surfaceStyles}
    >
      {/* Decorative background noise — very subtle */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
          opacity: 0.4,
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-24">

          {/* ── Left: Content ── */}
          <div className="flex flex-col justify-center">
            {/* Eyebrow */}
            {eyebrow && (
              <SlideUp duration={duration} ease={ease} delay={d0} className="mb-6">
                <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} />
              </SlideUp>
            )}

            {/* Title */}
            {title && (
              <SlideUp duration={duration} ease={ease} delay={d1} className="mb-6">
                <h1
                  className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-5xl xl:text-6xl"
                  style={{
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-heading)',
                  }}
                >
                  {title.split('\n').map((line, i) => (
                    <span key={i} className="block">{line}</span>
                  ))}
                </h1>
              </SlideUp>
            )}

            {/* Divider */}
            <SlideUp duration={duration} ease={ease} delay={d2} className="mb-6">
              <div
                className="h-[1px] w-12"
                style={{ backgroundColor: 'var(--color-primary)', opacity: 0.6 }}
              />
            </SlideUp>

            {/* Subtitle */}
            {subtitle && (
              <SlideUp duration={duration} ease={ease} delay={d3} className="mb-10">
                <p
                  className="max-w-md text-lg leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {subtitle}
                </p>
              </SlideUp>
            )}

            {/* CTAs */}
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
                        boxShadow: '0 4px 24px -4px var(--color-primary, rgba(220,38,38,0.4))',
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
                      style={{
                        color: 'var(--color-text-secondary)',
                        borderBottom: '1px solid var(--color-border)',
                        borderRadius: 0,
                      }}
                    />
                  )}
                </div>
              </SlideUp>
            )}

            {/* Trust signal row */}
            <SlideUp duration={duration} ease={ease} delay={d4 + 0.1}>
              <div
                className="mt-12 flex items-center gap-4 border-t pt-6"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex -space-x-2" aria-hidden="true">
                  {[
                    'oklch(0.55 0.15 250)',
                    'oklch(0.65 0.12 150)',
                    'oklch(0.70 0.10 30)',
                  ].map((bg, i) => (
                    <div
                      key={i}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: bg,
                        border: '2px solid var(--color-background)',
                      }}
                    />
                  ))}
                </div>
                <p
                  className="text-xs leading-snug"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Trusted by <strong style={{ color: 'var(--color-text-secondary)' }}>500+</strong> broadcasters worldwide
                </p>
              </div>
            </SlideUp>
          </div>

          {/* ── Right: Animated visual ── */}
          <SlideUp duration={duration} ease={ease} delay={0.15} once>
            <VisualColumn
              section={section}
              designSystem={designSystem}
              animationIntensity={animationIntensity}
            />
          </SlideUp>
        </div>
      </div>
    </section>
  )
}
