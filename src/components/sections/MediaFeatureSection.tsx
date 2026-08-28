'use client'

/**
 * MediaFeatureSection
 *
 * Reusable platform section: optional media on one side, a repeatable list of
 * feature rows on the other, with optional intro, closing line and CTAs.
 *
 * It replaces two bespoke one-off designs from the NoLogo site:
 *
 *   ProductShowcase  → mediaPosition 'left' | 'right' + mockupFrame: true.
 *                      Header (eyebrow/title/intro) runs full width above a
 *                      two-column band: browser-mockup screenshot on one side,
 *                      hairline-separated capability rows on the other, CTAs last.
 *
 *   Qualification    → mediaPosition 'none'. The header becomes the left column
 *                      and the feature rows the right column, with the optional
 *                      closingLine rendered in the heading font and accent colour.
 *
 * Both originals used fixed, breakpoint-free grids ('1.1fr 0.9fr' and '1fr 1fr').
 * Here every multi-column layout is single-column below `md` and only splits at
 * `md` and up, with the split itself driven by the `contentRatio` enum.
 *
 * Media presentation follows the platform convention: the section picks a named
 * style key and the Design System's `mediaStyles` array decides what it means.
 * No colours are resolved in JS — everything is a CSS custom property.
 */

import { useParams } from 'next/navigation'
import type {
  MediaFeatureSection as MediaFeatureSectionType,
  DesignSystem,
  MediaStyleDefinition,
} from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { Icon, isIconName } from '@/components/icons'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

// ─── Default media styles ─────────────────────────────────────────────────────
// Mirrors MediaContentSection: fallback definitions used when the Design System
// has no mediaStyles array yet. Kept byte-identical so both sections agree on
// what a named style means when the DS is silent.

const DEFAULT_MEDIA_STYLES: MediaStyleDefinition[] = [
  { key: 'default',    borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'rounded',    borderRadius: 16,   aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'square',     borderRadius: 8,    aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'landscape',  borderRadius: 8,    aspectRatio: '16/9', objectFit: 'cover' },
  { key: 'portrait',   borderRadius: 8,    aspectRatio: '3/4',  objectFit: 'cover' },
  { key: 'circle',     borderRadius: 9999, aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'fullHeight', borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
]

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

export function resolveMediaStyle(
  styleKey: string | undefined,
  dsStyles: MediaStyleDefinition[] | undefined,
): MediaStyleDefinition {
  const styles = dsStyles?.length ? dsStyles : DEFAULT_MEDIA_STYLES
  return styles.find((s) => s.key === (styleKey ?? 'default')) ?? DEFAULT_MEDIA_STYLES[0]
}

/**
 * Maps contentRatio → a Tailwind grid-cols class for the [media, features] pair
 * (or [header, features] when mediaPosition is 'none').
 *
 * `contentRatio` always describes content-first: '40/60' means the content
 * (feature) column gets 40% and the media column 60% — so when the media sits
 * on the left the fractions are emitted in the opposite order.
 *
 * Every value is `md:`-prefixed: below the md breakpoint the grid collapses to
 * one column. Both source designs hardcoded a desktop-only ratio with no
 * breakpoint at all, which is the bug this fixes.
 */
export function featureGridColsClass(
  ratio: string | undefined,
  mediaOnLeft: boolean,
): string {
  switch (ratio) {
    case '40/60':
      return mediaOnLeft ? 'md:grid-cols-[3fr_2fr]' : 'md:grid-cols-[2fr_3fr]'
    case '60/40':
      return mediaOnLeft ? 'md:grid-cols-[2fr_3fr]' : 'md:grid-cols-[3fr_2fr]'
    default:
      return 'md:grid-cols-2' // 50/50
  }
}

/** True when the section should render a media column at all. */
export function hasMediaColumn(
  mediaPosition: string | undefined,
  imageSrc: string | undefined,
): boolean {
  return mediaPosition !== 'none' && Boolean(imageSrc)
}

// ─── CTA row ──────────────────────────────────────────────────────────────────

function CtaRow({ section }: { section: MediaFeatureSectionType }) {
  // tenantId and locale are URL params — not stored in Sanity.
  // They're used here to build the correct full path for internal page CTA links.
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

  if ((!primaryCta || primaryCta.type === 'none') && (!secondaryCta || secondaryCta.type === 'none')) {
    return null
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-4">
      {primaryCta && primaryCta.type !== 'none' && (
        <CtaButton
          cta={primaryCta}
          className="inline-flex h-11 items-center gap-2 px-6 text-sm font-semibold tracking-wide transition-all duration-200 hover:opacity-90"
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
          className="inline-flex h-11 items-center gap-2 px-5 text-sm font-medium transition-all duration-150 hover:opacity-80"
          style={{
            color: 'var(--btn-secondary-text)',
            backgroundColor: 'var(--btn-secondary-bg)',
            borderRadius: 'var(--radius-btn)',
            border: '1.5px solid var(--color-border)',
          }}
        />
      )}
    </div>
  )
}

// ─── Feature row ──────────────────────────────────────────────────────────────

/**
 * One capability / bullet row: a small bordered accent box holding either the
 * chosen icon or — when no icon is set — a plain accent dot, then the title and
 * an optional description. Rows are separated by a hairline, matching the
 * TreatmentsSection pattern (border on each row, not on the wrapper).
 *
 * A row with only a `title` and no `description` degrades to the Qualification
 * bullet; a row with both is the ProductShowcase capability.
 */
function FeatureRowItem({
  feature,
}: {
  feature: NonNullable<MediaFeatureSectionType['features']>[number]
}) {
  return (
    <div
      className="flex items-start gap-4 py-5 md:gap-5 md:py-6"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      {/* Accent box — icon when one is chosen, dot otherwise */}
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center"
        aria-hidden="true"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-primary)',
        }}
      >
        {feature.icon && isIconName(feature.icon) ? (
          // Icon() itself returns null for an unknown key, which would leave an
          // empty box. Checking the registry first lets the dot stand in for a
          // missing *or* stale icon name. Colour is inherited via currentColor.
          <Icon name={feature.icon} size={14} />
        ) : (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: 'var(--color-primary)' }}
          />
        )}
      </span>

      <div className="min-w-0">
        {feature.title && (
          <h3
            className="text-[0.9375rem] font-semibold leading-snug tracking-tight"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {feature.title}
          </h3>
        )}
        {feature.description && (
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
          >
            {feature.description}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Media block ──────────────────────────────────────────────────────────────

/**
 * The screenshot, optionally wrapped in a browser-window chrome: a titlebar with
 * three window dots, a title string and an accent badge, then the image with a
 * soft bottom fade.
 *
 * The fade is a CSS mask rather than a gradient painted in the surface colour —
 * the original hardcoded `var(--bg)`, which breaks the moment the section sits
 * on a different surface. A mask fades the pixels themselves, so it is correct
 * on every surface the platform can put behind it.
 *
 * The three window dots are the only literal colours in this file: they are
 * decorative operating-system chrome, not theme colour, and would stop reading
 * as a window if they took the tenant palette.
 */
const WINDOW_DOTS = ['#ff5f57', '#febc2e', '#28c840'] as const

function MediaBlock({
  imageSrc,
  srcSet,
  alt,
  mockupFrame,
  mockupTitle,
  mockupBadge,
  containerStyle,
  imgStyle,
}: {
  imageSrc: string
  srcSet: string | undefined
  alt: string
  mockupFrame: boolean
  mockupTitle: string | undefined
  mockupBadge: string | undefined
  containerStyle: React.CSSProperties
  imgStyle: React.CSSProperties
}) {
  const picture = (
    <div
      style={mockupFrame ? { overflow: 'hidden' } : containerStyle}
      className="group relative w-full"
    >
      <img
        src={imageSrc}
        srcSet={srcSet}
        sizes="(min-width: 768px) 50vw, 100vw"
        alt={alt}
        loading="lazy"
        style={imgStyle}
        className={IMAGE_HOVER_CLASSES}
      />
      {mockupFrame && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%]"
          style={{
            // Fades the image out without needing to know the surface colour.
            backdropFilter: 'none',
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      )}
    </div>
  )

  if (!mockupFrame) return picture

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: containerStyle.borderRadius ?? 'var(--radius-md)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {/* Titlebar */}
      <div
        className="flex items-center gap-1.5 px-3 py-2.5"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {WINDOW_DOTS.map((dot) => (
          <span
            key={dot}
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: dot }}
          />
        ))}
        {mockupTitle && (
          <span
            className="ml-3 flex-1 truncate text-[0.6875rem] font-semibold tracking-[0.04em]"
            style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-heading)' }}
          >
            {mockupTitle}
          </span>
        )}
        {mockupBadge && (
          <span
            className={`${mockupTitle ? '' : 'ml-auto '}shrink-0 px-2 py-[3px] text-[0.5625rem] font-bold uppercase tracking-[0.1em]`}
            style={{
              color: 'var(--color-primary)',
              border: '1px solid var(--color-primary)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-heading)',
            }}
          >
            {mockupBadge}
          </span>
        )}
      </div>

      {/* Screenshot */}
      <div className="relative" style={{ lineHeight: 0 }}>
        {picture}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  section: MediaFeatureSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function MediaFeatureSection({ section, surface, designSystem }: Props) {
  const {
    eyebrow,
    title,
    intro,
    image,
    mediaPosition = 'left',
    contentRatio,
    mediaStyle: mediaStyleKey,
    mockupFrame = false,
    mockupTitle,
    mockupBadge,
    features,
    closingLine,
  } = section

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const imageSrc = imageUrl(image, 1400)
  const srcSet = imageSrcSet(image, [600, 900, 1200, 1600])
  const showMedia = hasMediaColumn(mediaPosition, imageSrc)
  const mediaOnLeft = mediaPosition === 'left'

  // Media style from the DS (or the shared fallbacks)
  const resolvedStyle = resolveMediaStyle(mediaStyleKey, designSystem?.mediaStyles)
  const hasFixedAspect = Boolean(resolvedStyle.aspectRatio && resolvedStyle.aspectRatio !== 'auto')
  const imgContainerStyle: React.CSSProperties = {
    borderRadius: resolvedStyle.borderRadius ? `${resolvedStyle.borderRadius}px` : undefined,
    // Always required so the hover zoom is clipped and the radius reaches the image
    overflow: 'hidden',
    aspectRatio: hasFixedAspect ? resolvedStyle.aspectRatio : undefined,
  }
  const imgStyle: React.CSSProperties = {
    objectFit: resolvedStyle.objectFit ?? 'cover',
    width: '100%',
    height: hasFixedAspect ? '100%' : 'auto',
    display: 'block',
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
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
          className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {title}
        </h2>
      )}
      {intro && (
        <p
          className="mt-6 max-w-2xl text-base leading-relaxed"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
        >
          {intro}
        </p>
      )}
      <div className="mt-8 h-px w-12" style={{ backgroundColor: 'var(--color-border)' }} />
    </SlideUp>
  )

  // ── Feature column (rows + closing line + CTAs) ───────────────────────────
  const featureColumn = (
    <div>
      {features && features.length > 0 && (
        <div className="grid gap-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          {features.map((feature, index) => (
            <SlideUp
              key={feature._key}
              duration={duration}
              ease={ease}
              delay={index * 0.05}
            >
              <FeatureRowItem feature={feature} />
            </SlideUp>
          ))}
        </div>
      )}

      {closingLine && (
        <SlideUp duration={duration} ease={ease} delay={0.1}>
          <p
            className="mt-8 text-base font-bold tracking-tight"
            style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {closingLine}
          </p>
        </SlideUp>
      )}

      <CtaRow section={section} />
    </div>
  )

  // ── Media column ──────────────────────────────────────────────────────────
  const mediaColumn = showMedia ? (
    <SlideUp duration={duration} ease={ease} delay={0.1} className="flex items-start justify-center">
      <MediaBlock
        imageSrc={imageSrc as string}
        srcSet={srcSet}
        alt={image?.alt ?? title ?? ''}
        mockupFrame={mockupFrame}
        mockupTitle={mockupTitle}
        mockupBadge={mockupBadge}
        containerStyle={imgContainerStyle}
        imgStyle={imgStyle}
      />
    </SlideUp>
  ) : null

  // ── Layout: no media (Qualification shape) ────────────────────────────────
  // Header becomes the left column, feature rows the right. Single column
  // below md — the original had a hardcoded 1fr 1fr with no breakpoint.
  if (!showMedia) {
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <div className={`grid gap-12 ${featureGridColsClass(contentRatio, false)} md:gap-16 lg:gap-24 items-start`}>
          <div>{header}</div>
          {featureColumn}
        </div>
      </SectionContainer>
    )
  }

  // ── Layout: media + features (ProductShowcase shape) ──────────────────────
  // Header spans the full width, then a two-column band. Single column below md
  // — the original had a hardcoded 1.1fr 0.9fr with no breakpoint.
  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="mb-14 md:mb-16">{header}</div>
      <div className={`grid gap-12 ${featureGridColsClass(contentRatio, mediaOnLeft)} md:gap-16 lg:gap-20 items-start`}>
        <div className={mediaOnLeft ? '' : 'order-last md:order-none'}>
          {mediaOnLeft ? mediaColumn : featureColumn}
        </div>
        <div className={mediaOnLeft ? 'order-last md:order-none' : ''}>
          {mediaOnLeft ? featureColumn : mediaColumn}
        </div>
      </div>
    </SectionContainer>
  )
}
