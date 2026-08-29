'use client'

// 'use client' is required by the optional `ctas[]` path below: an internal
// page CTA resolves to a bare "/slug" and has to be prefixed with the locale
// and tenant, both of which are URL params (useParams) rather than Sanity
// fields. This is the same approach MediaContentSection already uses, and the
// modules this file pulls in (SlideUp, @/lib/sanity/image) were already in the
// client bundle through those sections, so nothing new is shipped to it.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import type { HeroSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { urlFor } from '@/lib/sanity/image'
import { resolveCta, prefixCtaHref } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { useFormOverlaySafe } from '@/components/forms/FormOverlayContext'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline, lastContentLineIndex } from '@/lib/headline-accent'

const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'

interface Props {
  section: HeroSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

// ── Height map ────────────────────────────────────────────────────────────────
const HEIGHT_CLASSES: Record<string, string> = {
  small: 'min-h-[50vh]',
  medium: 'min-h-[70vh]',
  large: 'min-h-[90vh]',
  fullscreen: 'min-h-screen',
}

// ── Content width map ─────────────────────────────────────────────────────────
const WIDTH_CLASSES: Record<string, string> = {
  standard: 'max-w-5xl',
  wide: 'max-w-7xl',
  full: 'w-full',
}

// ── Justify (vertical alignment) map ─────────────────────────────────────────
const JUSTIFY_CLASSES: Record<string, string> = {
  top: 'justify-start',
  center: 'justify-center',
  bottom: 'justify-end',
}

// ── Text alignment map ────────────────────────────────────────────────────────
const TEXT_ALIGN_CLASSES: Record<string, string> = {
  left: 'text-left items-start',
  center: 'text-center items-center',
  right: 'text-right items-end',
}

// Pure helper — builds the CSS `filter` value for hero media backgrounds.
// GROQ returns `null` (not `undefined`) for unset numeric fields, so callers
// must not rely on destructuring defaults here; this helper coalesces null
// itself.
export function buildHeroMediaFilter(
  blur: number | null | undefined,
  brightness: number | null | undefined
): string | undefined {
  const resolvedBlur = blur ?? 0
  const resolvedBrightness = brightness ?? 100

  return [
    resolvedBlur > 0 ? `blur(${resolvedBlur}px)` : '',
    resolvedBrightness !== 100 ? `brightness(${resolvedBrightness / 100})` : '',
  ].filter(Boolean).join(' ') || undefined
}

// Pure helper — resolves the effective media layout. GROQ returns `null`
// (not `undefined`) for a `heroSection` document that predates this field,
// so `??` (not a destructuring default) is required to land on 'fullBleed'
// — the same null-vs-undefined shape as `buildHeroMediaFilter` above.
// This guarantees every existing hero (no `mediaLayout` in storage) renders
// pixel-for-pixel as it did before this field was introduced.
export function resolveHeroMediaLayout(
  mediaLayout: 'fullBleed' | 'boxed' | null | undefined
): 'fullBleed' | 'boxed' {
  return mediaLayout ?? 'fullBleed'
}

// Pure helper — resolves the primary CTA's background/text colours.
//
// Without full-bleed media the hero has always used the design-system colours,
// and that branch is untouched. Over full-bleed media the historical treatment
// is a white button with black text; that is what an absent/null `ctaStyle`
// resolves to ('onMedia'), so every existing hero keeps exactly the colours it
// has today. Only an explicit 'brand' switches to the design system's button
// tokens — the same `--btn-primary-bg` / `--btn-primary-text` pair CtaButton
// consumers such as MediaContentSection and CtaBannerSection already use.
//
// GROQ returns `null` (not `undefined`) for a field no document has, hence
// `??` rather than a destructuring default — the same null-vs-undefined shape
// as buildHeroMediaFilter / resolveHeroMediaLayout above.
export function resolveHeroCtaColors(
  ctaStyle: 'onMedia' | 'brand' | null | undefined,
  showFullBleedMedia: boolean
): { ctaBg: string; ctaText: string } {
  if (!showFullBleedMedia) {
    return { ctaBg: 'var(--color-primary)', ctaText: 'var(--color-background)' }
  }

  return (ctaStyle ?? 'onMedia') === 'brand'
    ? { ctaBg: 'var(--btn-primary-bg)', ctaText: 'var(--btn-primary-text)' }
    : { ctaBg: '#ffffff', ctaText: '#000000' }
}

// Pure helper — builds the Cloudflare Stream HLS manifest URL for a Stream UID.
//
// This replaces the previous `/downloads/default.mp4` URL, which only exists
// after somebody has POSTed to Cloudflare's `/downloads` API for that one
// specific video. There is no dashboard toggle for it and nothing in the
// Studio told an editor it was needed, so any newly-uploaded hero video
// silently rendered a black box. `/manifest/video.m3u8` is generated by
// Cloudflare for every ready video with no per-video API step at all.
export function buildHeroVideoManifestUrl(
  account: string,
  uid: string | null | undefined
): string | null {
  return uid ? `https://${account}.cloudflarestream.com/${uid}/manifest/video.m3u8` : null
}

// ── HLS background video ─────────────────────────────────────────────────────
// Renders the same muted/looping/autoplaying background <video> the hero has
// always had — only the attach mechanism changes:
//
//   • Safari / iOS play HLS natively, so we just set `src` (feature-detected
//     via canPlayType, never via UA sniffing).
//   • Every other browser needs hls.js. It is imported *dynamically* inside
//     this effect, so it is only ever fetched when a hero actually has a
//     video: an image-hero tenant never downloads a byte of it, and it does
//     not enter the default client bundle.
//
// If anything fails — the chunk won't load, hls.js isn't supported, the
// manifest errors — we fall back to rendering the poster image rather than a
// black box. Nothing here throws.
function HeroBackgroundVideo({
  src,
  poster,
  className,
  filter,
}: {
  src: string
  poster: string | null
  className: string
  filter: string | undefined
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Autoplay is only ever allowed for a muted video; the promise still
    // rejects in some contexts (low-power mode, reduced-motion policies),
    // and an unhandled rejection there must not surface as an error.
    const tryPlay = () => {
      const p = video.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }

    // Native HLS (Safari, iOS). No library needed.
    if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
      video.src = src
      tryPlay()
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    let cancelled = false
    let instance: { destroy: () => void } | null = null

    void (async () => {
      try {
        const { default: Hls } = await import('hls.js')
        if (cancelled) return

        if (!Hls.isSupported()) {
          setFailed(true)
          return
        }

        const hls = new Hls()
        instance = hls

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data?.fatal) return
          // A fatal error means this element will never show a frame — drop
          // back to the poster instead of leaving a black rectangle.
          setFailed(true)
          try {
            hls.destroy()
          } catch {
            /* already torn down */
          }
          if (instance === hls) instance = null
        })
        hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)

        hls.loadSource(src)
        hls.attachMedia(video)
      } catch {
        // Dynamic import rejected (offline, chunk 404) — poster fallback.
        if (!cancelled) setFailed(true)
      }
    })()

    // Destroying on unmount is required: a leaked Hls instance keeps
    // downloading segments for a hero that is no longer on screen.
    return () => {
      cancelled = true
      if (instance) {
        try {
          instance.destroy()
        } catch {
          /* already torn down */
        }
        instance = null
      }
    }
  }, [src])

  if (failed) {
    // Poster fallback. Same box, same filters — just a still image.
    if (!poster) return null
    return (
      <div
        className={`${className} bg-cover bg-center`}
        style={{ backgroundImage: `url(${poster})`, filter }}
        aria-hidden="true"
      />
    )
  }

  return (
    <video
      ref={videoRef}
      className={className}
      style={{ filter }}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
    />
  )
}

export function HeroSection({ section, surface, designSystem }: Props) {
  const {
    eyebrow, headline, headlineAccent, subheadline, tagline, ctaLabel, ctaHref,
    mediaType, heroImage, heroVideo, posterImage,
    heroHeight = 'large',
    contentWidth = 'standard',
    contentAlignment = 'left',
    verticalAlignment = 'center',
    stats,
    ctas,
  } = section

  // Numeric style fields — GROQ returns `null` for unset fields, which
  // bypasses destructuring defaults (those only trigger on `undefined`).
  // Normalize with `??` so an unset field falls back to its intended
  // default instead of producing `brightness(0)` / a silently-skipped
  // overlay.
  const overlayOpacity = section.overlayOpacity ?? 40
  const blur = section.blur ?? 0
  const brightness = section.brightness ?? 100

  const hasMedia = mediaType === 'image' ? !!heroImage?.asset : mediaType === 'video' ? !!heroVideo : false
  const mediaLayout = resolveHeroMediaLayout(section.mediaLayout)
  // A hero only gets the full-bleed background treatment when it actually
  // has media AND is in fullBleed mode (the default). Boxed mode — or
  // media-less heroes — always render on the section's normal surface with
  // normal text colors; `mediaLayout` on a media-less hero is a no-op.
  const showFullBleedMedia = hasMedia && mediaLayout === 'fullBleed'
  const showBoxedMedia = hasMedia && mediaLayout === 'boxed'
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  // Stagger offsets
  const d1 = eyebrow ? 0.1 : 0
  const d2 = eyebrow ? 0.2 : 0.1
  const d3 = eyebrow ? 0.3 : 0.2
  const d4 = eyebrow ? 0.4 : 0.3
  const d5 = eyebrow ? 0.5 : 0.4 // boxed media frame — after the CTA

  const d6 = d5 + 0.1 // optional stat row — after the CTA / boxed media frame

  // ── Optional ctas[] (second CTA path) ─────────────────────────────────────
  // An internal 'page' CTA resolves to a bare "/slug"; locale + tenant come
  // from the URL, exactly as in MediaContentSection.
  const params = useParams()
  const paramLocale = params?.locale as string | undefined
  const paramTenant = params?.tenant as string | undefined

  // Only CTAs that actually resolve to something count — an unfinished CTA in
  // Studio must not suppress the legacy ctaLabel/ctaHref pair.
  const resolvedCtas = (ctas ?? [])
    .map((cta) => prefixCtaHref(resolveCta(cta), paramLocale, paramTenant))
    .filter((cta) => cta.type !== 'none')

  // Bridge form CTAs to the form overlay, by the form's stable route key.
  // Same pattern as HeroLensSection / HeroLiveCaptureSection: the null-safe
  // hook means a page without a FormOverlayProvider keeps rendering the button
  // exactly as before — it simply has no handler, which is today's behaviour.
  const formOverlay = useFormOverlaySafe()

  function makeFormHandler(cta: ReturnType<typeof resolveCta> | undefined): (() => void) | undefined {
    if (!cta || cta.type !== 'form') return undefined

    if (cta.formId && formOverlay) {
      const formId = cta.formId
      // Optional authored pre-fill. Omitted entirely when the CTA has none, so
      // the open request is byte-identical to before for every existing CTA.
      const context = cta.context
      return () => formOverlay.open({
        formId,
        ...(context ? { context } : {}),
        source: {
          source: 'hero_section',
          cta_internal_name: cta.internalName ?? null,
          cta_label_snapshot: cta.label ?? null,
        },
      })
    }

    return undefined
  }

  const headlineLines = headline?.split('\n') ?? []
  // The accent (when enabled) belongs to the last line that actually carries a
  // word — a headline ending in a stray "\n" must not accent an empty line.
  const accentLineIndex = lastContentLineIndex(headlineLines)

  const heightClass = HEIGHT_CLASSES[heroHeight] ?? HEIGHT_CLASSES.large
  const widthClass = WIDTH_CLASSES[contentWidth] ?? WIDTH_CLASSES.standard
  const justifyClass = JUSTIFY_CLASSES[verticalAlignment] ?? JUSTIFY_CLASSES.center
  const textAlignClass = TEXT_ALIGN_CLASSES[contentAlignment] ?? TEXT_ALIGN_CLASSES.left

  // Content text color: white over media only in fullBleed mode (text sits
  // on top of the full-cover image/video there). Boxed mode — like the
  // no-media case — renders on the section's normal surface, so it always
  // uses standard DS text tokens.
  const textPrimary = showFullBleedMedia ? '#ffffff' : 'var(--color-text-primary)'
  const textSecondary = showFullBleedMedia ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary)'
  const dividerColor = showFullBleedMedia ? 'rgba(255,255,255,0.3)' : 'var(--color-primary)'
  const dividerOpacity = showFullBleedMedia ? undefined : 0.6
  const { ctaBg, ctaText } = resolveHeroCtaColors(section.ctaStyle, showFullBleedMedia)

  // Build image URL for heroImage background
  const heroImageUrl = heroImage?.asset
    ? urlFor(heroImage).width(1920).height(1080).fit('crop').auto('format').url()
    : null

  // Build poster URL for video
  const posterUrl = posterImage?.asset
    ? urlFor(posterImage).width(1920).height(1080).fit('crop').auto('format').url()
    : heroImageUrl // fallback to heroImage if no poster

  // Cloudflare Stream HLS manifest URL for background video
  const videoUrl = buildHeroVideoManifestUrl(CLOUDFLARE_ACCOUNT, heroVideo)

  // CSS filter for media background
  const mediaFilter = buildHeroMediaFilter(blur, brightness)

  return (
    <section
      id={section.anchorId}
      className={`relative flex flex-col px-6 py-24 md:px-16 lg:px-24 ${heightClass} ${justifyClass}`}
      style={showFullBleedMedia ? undefined : surfaceStyles}
    >
      {/* ── Media background (fullBleed mode only) ───────────────────────── */}
      {showFullBleedMedia && (
        <>
          {/* Image background */}
          {mediaType === 'image' && heroImageUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${heroImageUrl})`,
                filter: mediaFilter,
              }}
              aria-hidden="true"
            />
          )}

          {/* Video background */}
          {mediaType === 'video' && videoUrl && (
            <HeroBackgroundVideo
              className="absolute inset-0 h-full w-full object-cover"
              filter={mediaFilter}
              src={videoUrl}
              poster={posterUrl}
            />
          )}

          {/* Overlay — fullBleed only; boxed media never sits under page text */}
          {overlayOpacity > 0 && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity / 100})` }}
              aria-hidden="true"
            />
          )}
        </>
      )}

      {/* ── Decorative left border accent (surface mode — no fullBleed media) ── */}
      {!showFullBleedMedia && (
        <div
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: 'var(--color-primary)' }}
          aria-hidden="true"
        />
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className={`relative mx-auto w-full ${widthClass} flex flex-col ${textAlignClass}`}>
        {/* Eyebrow */}
        {eyebrow && (
          <SlideUp duration={duration} ease={ease} delay={0} className="mb-8">
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              onMedia={hasMedia}
              // Opt-in, design-system driven. Absent on every tenant that
              // predates the field → 'plain', the inline eyebrow this hero has
              // always rendered.
              variant={designSystem?.heroEyebrowVariant === 'pill' ? 'pill' : 'plain'}
            />
          </SlideUp>
        )}

        {/* Headline */}
        <SlideUp duration={duration} ease={ease} delay={d1} className="mb-8">
          <h1
            className="[--fs-h1:3rem] md:[--fs-h1:3.75rem] lg:[--fs-h1:4.5rem]"
            style={{ color: textPrimary, fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h1, var(--fs-h1))', fontWeight: 'var(--font-weight-h1, 600)', lineHeight: 'var(--line-height-h1, 1.1)', letterSpacing: 'var(--letter-spacing-h1, -0.025em)' }}
          >
            {headlineLines.length > 1
              ? headlineLines.map((line, i) => (
                  <span key={i} className="block">
                    {i === accentLineIndex ? renderHeadline(line, headlineAccent) : line}
                  </span>
                ))
              : renderHeadline(headline, headlineAccent)}
          </h1>
        </SlideUp>

        {/* Divider */}
        <SlideUp duration={duration} ease={ease} delay={d2} className="mb-8">
          <div
            className={`h-[1px] w-16 ${contentAlignment === 'center' ? 'mx-auto' : contentAlignment === 'right' ? 'ml-auto' : ''}`}
            style={{ backgroundColor: dividerColor, opacity: dividerOpacity }}
          />
        </SlideUp>

        {/* Subheadline. The bottom margin only changes when a tagline follows
            it — with no tagline this is the same `mb-12` it has always been. */}
        {subheadline && (
          <SlideUp duration={duration} ease={ease} delay={d3} className={tagline ? 'mb-3' : 'mb-12'}>
            <p
              className="max-w-xl text-lg leading-relaxed"
              style={{ color: textSecondary }}
            >
              {subheadline}
            </p>
          </SlideUp>
        )}

        {/* Optional tagline — a short, bold line between the subheadline and
            the CTA row, as on the original site. Absent `tagline` renders
            nothing at all, so this is a no-op for every existing hero. It uses
            the same `textPrimary` white-over-media colour the headline uses
            (one step brighter than the subheadline), a heavier weight and a
            tighter leading, and preserves authored "\n" line breaks. It shares
            the subheadline's `d3` delay because the two read as one block. */}
        {tagline && (
          <SlideUp duration={duration} ease={ease} delay={d3} className="mb-12">
            <p
              className="max-w-xl whitespace-pre-line text-lg font-semibold leading-snug"
              style={{ color: textPrimary }}
            >
              {tagline}
            </p>
          </SlideUp>
        )}

        {/* CTA — `ctas[]` when authored, otherwise the legacy scalar pair.
            The legacy branch below is byte-identical to what shipped before
            `ctas` existed, so every existing hero renders exactly as it did. */}
        {resolvedCtas.length > 0 ? (
          <SlideUp duration={duration} ease={ease} delay={d4}>
            <div
              className={`flex flex-wrap items-center gap-4 ${
                contentAlignment === 'center' ? 'justify-center' : contentAlignment === 'right' ? 'justify-end' : ''
              }`}
            >
              {resolvedCtas.map((cta, i) => (
                <CtaButton
                  key={`${cta.internalName}-${i}`}
                  cta={cta}
                  onFormClick={makeFormHandler(cta)}
                  className="inline-flex h-12 items-center gap-2 px-8 text-sm font-medium tracking-wide transition-opacity hover:opacity-85"
                  style={
                    i === 0
                      ? { backgroundColor: ctaBg, color: ctaText }
                      : { color: textPrimary, border: `1px solid ${dividerColor}`, backgroundColor: 'transparent' }
                  }
                >
                  {cta.label}
                  {i === 0 && (
                    <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
                  )}
                </CtaButton>
              ))}
            </div>
          </SlideUp>
        ) : ctaLabel ? (
          <SlideUp duration={duration} ease={ease} delay={d4}>
            <a
              href={ctaHref ?? '#'}
              className="inline-flex h-12 items-center gap-2 px-8 text-sm font-medium tracking-wide transition-opacity hover:opacity-85"
              style={{ backgroundColor: ctaBg, color: ctaText }}
            >
              {ctaLabel}
              <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
            </a>
          </SlideUp>
        ) : null}

        {/* Optional stat row — sits beneath the CTA. Absent `stats` renders
            nothing at all, so this is a no-op for every existing hero. The
            white-over-media treatment is the same textPrimary/textSecondary
            pair the headline and subheadline use. */}
        {stats && stats.length > 0 && (
          <SlideUp duration={duration} ease={ease} delay={d6} className="mt-12 w-full">
            <div
              className={`flex flex-wrap gap-x-12 gap-y-6 ${
                contentAlignment === 'center' ? 'justify-center' : contentAlignment === 'right' ? 'justify-end' : ''
              }`}
            >
              {stats.map((stat) => (
                <div key={stat._key} className="flex flex-col">
                  <span
                    className="text-3xl font-semibold leading-none tracking-tight md:text-4xl"
                    style={{ color: textPrimary, fontFamily: 'var(--font-heading)' }}
                  >
                    {stat.value}
                  </span>
                  {stat.label && (
                    <span
                      className="mt-2 text-xs font-medium uppercase tracking-[0.2em]"
                      style={{ color: textSecondary }}
                    >
                      {stat.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </SlideUp>
        )}

        {/* ── Boxed media frame ──────────────────────────────────────────── */}
        {showBoxedMedia && (
          <SlideUp duration={duration} ease={ease} delay={d5} className="mt-4 w-full">
            <div
              className="relative w-full overflow-hidden"
              style={{
                aspectRatio: '16 / 9',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
              }}
            >
              {mediaType === 'image' && heroImageUrl && (
                <img
                  src={heroImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ filter: mediaFilter }}
                  aria-hidden="true"
                />
              )}

              {mediaType === 'video' && videoUrl && (
                <HeroBackgroundVideo
                  className="h-full w-full object-cover"
                  filter={mediaFilter}
                  src={videoUrl}
                  poster={posterUrl}
                />
              )}

              {/* Media brightness/blur still apply inside the frame; no dark
                  overlay here — boxed media never carries page text on top
                  of it, so overlayOpacity (readability aid) doesn't apply. */}
            </div>
          </SlideUp>
        )}
      </div>

      {/* ── Scroll indicator ─────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div
          className="h-8 w-[1px] animate-pulse"
          style={{ backgroundColor: showFullBleedMedia ? 'rgba(255,255,255,0.4)' : 'var(--color-border)' }}
        />
      </div>
    </section>
  )
}
