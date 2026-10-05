import type { VideoSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { getVideoSectionMessages } from '@/lib/i18n/video-section-messages'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { ConsentEmbed } from '@/components/consent/ConsentEmbed'
import { DIRECT_VIDEO_FILE_RE, embedVendorName, videoSectionVendor } from '@/lib/consent/embeds'

// Cloudflare Stream account/customer code for iframe embed URLs. Reuses the
// exact value already established in HeroSection.tsx for the same Stream
// account's MP4 download URL (`heroVideo` background video). Kept as a local
// constant rather than duplicated import to avoid coupling VideoSection to
// HeroSection — see handoff notes re: promoting this to an env var.
const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'

const ASPECT_RATIO_CLASS: Record<NonNullable<VideoSection['aspectRatio']>, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '9:16': 'aspect-[9/16]',
}

/** Same ratios for the click-to-load placeholder (CSS aspect-ratio). */
const ASPECT_RATIO_CSS: Record<NonNullable<VideoSection['aspectRatio']>, string> = {
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '9:16': '9 / 16',
}

// Direct video file extensions (DIRECT_VIDEO_FILE_RE) are rendered via
// <video controls> with no consent gate — see ADR-021 amendment 2026-10-05
// (own/Sanity CDN). Anything else with provider 'url' is an embeddable player
// URL (iframe) and goes through ConsentEmbed like every other provider.

interface Props {
  section: VideoSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** BCP 47 locale string — used to resolve the fallback accessible player label. */
  locale?: string
}

export function VideoSection({ section, surface, designSystem, locale = 'en' }: Props) {
  const { provider, videoId, videoUrl, eyebrow, title, caption } = section
  const aspectRatio = section.aspectRatio ?? '16:9'
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = getVideoSectionMessages(locale)

  // Motion tokens — durationSlow for content-style entrances, ms → seconds
  const mot = designSystem?.motion
  const duration = mot?.durationSlow !== undefined ? mot.durationSlow / 1000 : 0.35
  const ease = resolveEasing(mot?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const accessibleLabel = title || m.defaultPlayerLabel
  const aspectClass = ASPECT_RATIO_CLASS[aspectRatio]

  // ── Resolve the player for the configured provider ─────────────────────────
  let player: React.ReactNode = null

  if (provider === 'cloudflare' && videoId) {
    player = (
      <iframe
        src={`https://${CLOUDFLARE_ACCOUNT}.cloudflarestream.com/${videoId}/iframe`}
        title={accessibleLabel}
        className="h-full w-full"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
      />
    )
  } else if (provider === 'youtube' && videoId) {
    player = (
      <iframe
        // Privacy-enhanced mode (ADR-021): no YouTube cookies until playback.
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={accessibleLabel}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    )
  } else if (provider === 'vimeo' && videoId) {
    player = (
      <iframe
        // dnt=1 (ADR-021): Vimeo sets no tracking cookies for this player.
        src={`https://player.vimeo.com/video/${videoId}?dnt=1`}
        title={accessibleLabel}
        className="h-full w-full"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
      />
    )
  } else if (provider === 'url' && videoUrl) {
    if (DIRECT_VIDEO_FILE_RE.test(videoUrl)) {
      player = (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={videoUrl}
          controls
          className="h-full w-full"
          aria-label={accessibleLabel}
        />
      )
    } else {
      player = (
        <iframe
          src={videoUrl}
          title={accessibleLabel}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )
    }
  }

  // Guard against a missing/misconfigured source — render nothing rather
  // than a broken embed.
  if (!player) return null

  // ADR-021 — every third-party player is click-to-load until the visitor
  // accepts External content (or always-allows this vendor). Before that the
  // server HTML holds the placeholder only: no iframe, no embed URL.
  const vendorId = videoSectionVendor(section)
  const frame = <div className={`overflow-hidden rounded-[var(--radius-md)] ${aspectClass}`}>{player}</div>
  let gated: React.ReactNode = frame
  if (vendorId) {
    const vendorName = embedVendorName(vendorId)
    gated = (
      <ConsentEmbed
        vendorId={vendorId}
        vendorName={vendorName}
        locale={locale}
        aspectRatio={ASPECT_RATIO_CSS[aspectRatio]}
        labels={{
          notice: m.videoConsentNotice(vendorName),
          load: m.showVideo,
          alwaysAllow: m.videoAlwaysAllow(vendorName),
        }}
      >
        {frame}
      </ConsentEmbed>
    )
  }

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="mx-auto max-w-[900px]">
        {(eyebrow || title) && (
          <SlideUp duration={duration} ease={ease} delay={0}>
            {eyebrow && (
              <EyebrowLabel
                eyebrow={eyebrow}
                designSystem={designSystem}
                defaultAccent="none"
                className="mb-4"
              />
            )}
            {title && (
              <h2
                className="mb-10 [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
              >
                {title}
              </h2>
            )}
          </SlideUp>
        )}
        <SlideUp duration={duration} ease={ease} delay={0.1}>
          {gated}
        </SlideUp>
        {caption && (
          <SlideUp duration={duration} ease={ease} delay={0.15}>
            <p
              className="mt-4 text-sm leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {caption}
            </p>
          </SlideUp>
        )}
      </div>
    </SectionContainer>
  )
}
