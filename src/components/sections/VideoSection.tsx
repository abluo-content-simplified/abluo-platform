import type { VideoSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { getVideoSectionMessages } from '@/lib/i18n/video-section-messages'

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

// Direct video file extensions — rendered via <video controls>. Anything
// else with provider 'url' is treated as an embeddable player URL (iframe).
const DIRECT_VIDEO_FILE_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i

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
  const ease: string | number[] = mot?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

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
        src={`https://www.youtube.com/embed/${videoId}`}
        title={accessibleLabel}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    )
  } else if (provider === 'vimeo' && videoId) {
    player = (
      <iframe
        src={`https://player.vimeo.com/video/${videoId}`}
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

  return (
    <SectionContainer style={surfaceStyles}>
      <div className="mx-auto max-w-[900px]">
        {(eyebrow || title) && (
          <SlideUp duration={duration} ease={ease} delay={0}>
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
                className="mb-10 text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {title}
              </h2>
            )}
          </SlideUp>
        )}
        <SlideUp duration={duration} ease={ease} delay={0.1}>
          <div className={`overflow-hidden rounded-lg ${aspectClass}`}>
            {player}
          </div>
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
