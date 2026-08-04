import type { HeroSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { urlFor } from '@/lib/sanity/image'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

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

export function HeroSection({ section, surface, designSystem }: Props) {
  const {
    eyebrow, headline, subheadline, ctaLabel, ctaHref,
    mediaType, heroImage, heroVideo, posterImage,
    heroHeight = 'large',
    contentWidth = 'standard',
    contentAlignment = 'left',
    verticalAlignment = 'center',
    overlayOpacity = 40,
    blur = 0,
    brightness = 100,
  } = section

  const hasMedia = mediaType === 'image' ? !!heroImage?.asset : mediaType === 'video' ? !!heroVideo : false
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Stagger offsets
  const d1 = eyebrow ? 0.1 : 0
  const d2 = eyebrow ? 0.2 : 0.1
  const d3 = eyebrow ? 0.3 : 0.2
  const d4 = eyebrow ? 0.4 : 0.3

  const headlineLines = headline?.split('\n') ?? []

  const heightClass = HEIGHT_CLASSES[heroHeight] ?? HEIGHT_CLASSES.large
  const widthClass = WIDTH_CLASSES[contentWidth] ?? WIDTH_CLASSES.standard
  const justifyClass = JUSTIFY_CLASSES[verticalAlignment] ?? JUSTIFY_CLASSES.center
  const textAlignClass = TEXT_ALIGN_CLASSES[contentAlignment] ?? TEXT_ALIGN_CLASSES.left

  // Content text color: white over media, surface token otherwise
  const textPrimary = hasMedia ? '#ffffff' : 'var(--color-text-primary)'
  const textSecondary = hasMedia ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary)'
  const dividerColor = hasMedia ? 'rgba(255,255,255,0.3)' : 'var(--color-primary)'
  const dividerOpacity = hasMedia ? undefined : 0.6
  const ctaBg = hasMedia ? '#ffffff' : 'var(--color-primary)'
  const ctaText = hasMedia ? '#000000' : 'var(--color-background)'

  // Build image URL for heroImage background
  const heroImageUrl = heroImage?.asset
    ? urlFor(heroImage).width(1920).height(1080).fit('crop').auto('format').url()
    : null

  // Build poster URL for video
  const posterUrl = posterImage?.asset
    ? urlFor(posterImage).width(1920).height(1080).fit('crop').auto('format').url()
    : heroImageUrl // fallback to heroImage if no poster

  // Cloudflare Stream MP4 URL for background video
  const videoUrl = heroVideo
    ? `https://${CLOUDFLARE_ACCOUNT}.cloudflarestream.com/${heroVideo}/downloads/default.mp4`
    : null

  // CSS filter for media background
  const mediaFilter = [
    blur > 0 ? `blur(${blur}px)` : '',
    brightness !== 100 ? `brightness(${brightness / 100})` : '',
  ].filter(Boolean).join(' ') || undefined

  return (
    <section
      className={`relative flex flex-col px-6 py-24 md:px-16 lg:px-24 ${heightClass} ${justifyClass}`}
      style={hasMedia ? undefined : surfaceStyles}
    >
      {/* ── Media background ─────────────────────────────────────────────── */}
      {hasMedia && (
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
            <video
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: mediaFilter }}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
            />
          )}

          {/* Overlay */}
          {overlayOpacity > 0 && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity / 100})` }}
              aria-hidden="true"
            />
          )}
        </>
      )}

      {/* ── Decorative left border accent (no-media mode only) ───────────── */}
      {!hasMedia && (
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
            <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} onMedia={hasMedia} />
          </SlideUp>
        )}

        {/* Headline */}
        <SlideUp duration={duration} ease={ease} delay={d1} className="mb-8">
          <h1
            className="text-5xl font-semibold leading-[1.1] tracking-tight md:text-6xl lg:text-7xl"
            style={{ color: textPrimary, fontFamily: 'var(--font-heading)' }}
          >
            {headlineLines.length > 1
              ? headlineLines.map((line, i) => <span key={i} className="block">{line}</span>)
              : headline}
          </h1>
        </SlideUp>

        {/* Divider */}
        <SlideUp duration={duration} ease={ease} delay={d2} className="mb-8">
          <div
            className={`h-[1px] w-16 ${contentAlignment === 'center' ? 'mx-auto' : contentAlignment === 'right' ? 'ml-auto' : ''}`}
            style={{ backgroundColor: dividerColor, opacity: dividerOpacity }}
          />
        </SlideUp>

        {/* Subheadline */}
        {subheadline && (
          <SlideUp duration={duration} ease={ease} delay={d3} className="mb-12">
            <p
              className="max-w-xl text-lg leading-relaxed"
              style={{ color: textSecondary }}
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
              style={{ backgroundColor: ctaBg, color: ctaText }}
            >
              {ctaLabel}
              <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
            </a>
          </SlideUp>
        )}
      </div>

      {/* ── Scroll indicator ─────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div
          className="h-8 w-[1px] animate-pulse"
          style={{ backgroundColor: hasMedia ? 'rgba(255,255,255,0.4)' : 'var(--color-border)' }}
        />
      </div>
    </section>
  )
}
