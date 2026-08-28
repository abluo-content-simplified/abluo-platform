'use client'

/**
 * MediaContentSection
 *
 * Core platform building block for text + optional image layouts.
 * Replaces ContentSection — backward compatible: Sanity type name is still 'contentSection'.
 *
 * Layout variants driven by mediaPosition:
 *   none   → text-only (classic two-column eyebrow/title + body)
 *   left   → image left, text right
 *   right  → image right, text left (default)
 *   top    → image above text (stacked)
 *   bottom → image below text (stacked)
 *
 * Media presentation is controlled entirely by the Design System's mediaStyles array.
 * The section picks a named style (e.g. 'rounded'); the DS defines what that means.
 * No image styles are hardcoded here.
 */

import { useParams } from 'next/navigation'
import type { MediaContentSection as MediaContentSectionType, DesignSystem, MediaStyleDefinition, PortableTextBlock } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl } from '@/lib/sanity/image'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

// ─── Default media styles ─────────────────────────────────────────────────────
// Fallback style definitions used when the Design System has no mediaStyles array.
// These match the Base DS defaults that should be seeded in Sanity.

const DEFAULT_MEDIA_STYLES: MediaStyleDefinition[] = [
  { key: 'default',    borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'rounded',    borderRadius: 16,   aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'square',     borderRadius: 8,    aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'landscape',  borderRadius: 8,    aspectRatio: '16/9', objectFit: 'cover' },
  { key: 'portrait',   borderRadius: 8,    aspectRatio: '3/4',  objectFit: 'cover' },
  { key: 'circle',     borderRadius: 9999, aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'fullHeight', borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveMediaStyle(
  styleKey: string | undefined,
  dsStyles: MediaStyleDefinition[] | undefined
): MediaStyleDefinition {
  const styles = dsStyles?.length ? dsStyles : DEFAULT_MEDIA_STYLES
  return styles.find((s) => s.key === (styleKey ?? 'default')) ?? DEFAULT_MEDIA_STYLES[0]
}

/** Maps contentRatio enum → Tailwind grid-cols class for [text, media] columns */
function gridColsClass(ratio: string | undefined, mediaOnLeft: boolean): string {
  switch (ratio) {
    case '40/60': return mediaOnLeft ? 'md:grid-cols-[3fr_2fr]' : 'md:grid-cols-[2fr_3fr]'
    case '60/40': return mediaOnLeft ? 'md:grid-cols-[2fr_3fr]' : 'md:grid-cols-[3fr_2fr]'
    default:      return 'md:grid-cols-2' // 50/50
  }
}

/** Maps verticalAlignment → Tailwind items-* class */
function alignItemsClass(alignment: string | undefined): string {
  switch (alignment) {
    case 'top':    return 'items-start'
    case 'bottom': return 'items-end'
    default:       return 'items-center'
  }
}

// ─── Shared rich-text rendering ───────────────────────────────────────────────
//
// Portable Text blocks carry three things this renderer must not drop:
//   1. `listItem: 'bullet' | 'number'` — consecutive list blocks are buffered
//      and flushed as one <ul> / <ol> (the approach TextSection introduced,
//      extended here to numbered lists).
//   2. decorator marks — 'strong' / 'em' (plus 'underline' / 'code').
//   3. link annotations — a mark key pointing at a markDefs entry with an href.
//
// IDENTICAL-OUTPUT GUARANTEE: when no span in a block carries a mark, the
// children are joined into one string exactly as the previous
// `.map(c => c.text).join('')` did, so plain-paragraph content authored by
// existing tenants renders byte-for-byte as before. Element children only
// appear once a block actually has marks.

interface RichTextMarkDef {
  _key: string
  _type?: string
  href?: string
}

function renderRichTextSpans(block: PortableTextBlock): React.ReactNode {
  const hasMarks = block.children.some((c) => (c.marks?.length ?? 0) > 0)
  if (!hasMarks) return block.children.map((c) => c.text).join('')

  const defs = (block.markDefs ?? []) as RichTextMarkDef[]

  return block.children.map((span, i) => {
    const marks = span.marks ?? []
    let node: React.ReactNode = span.text

    // Decorators innermost, annotations wrapping them.
    if (marks.includes('code')) node = <code>{node}</code>
    if (marks.includes('underline')) node = <u>{node}</u>
    if (marks.includes('em')) node = <em>{node}</em>
    if (marks.includes('strong')) node = <strong>{node}</strong>

    const linkDef = defs.find((d) => d?.href && marks.includes(d._key))
    if (linkDef?.href) {
      const external = /^(https?:)?\/\//i.test(linkDef.href) || linkDef.href.startsWith('mailto:')
      node = (
        <a
          href={linkDef.href}
          style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {node}
        </a>
      )
    }

    return <span key={span._key ?? `span-${i}`}>{node}</span>
  })
}

function RichText({ blocks }: { blocks: NonNullable<MediaContentSectionType['body']> }) {
  const elements: React.ReactNode[] = []
  let listBuffer: PortableTextBlock[] = []
  let listKind: 'bullet' | 'number' | null = null

  const flushList = () => {
    if (listBuffer.length === 0) return
    const items = listBuffer
    const kind = listKind
    listBuffer = []
    listKind = null

    if (kind === 'number') {
      elements.push(
        <ol key={`ol-${items[0]._key}`} className="list-decimal space-y-2 pl-6">
          {items.map((b) => (
            <li
              key={b._key}
              className="text-base leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {renderRichTextSpans(b)}
            </li>
          ))}
        </ol>
      )
      return
    }

    elements.push(
      <ul key={`ul-${items[0]._key}`} className="space-y-2 pl-4">
        {items.map((b) => (
          <li
            key={b._key}
            className="flex gap-2 text-base leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--color-text-muted)' }}
              aria-hidden="true"
            />
            <span>{renderRichTextSpans(b)}</span>
          </li>
        ))}
      </ul>
    )
  }

  blocks.forEach((block) => {
    if (block._type !== 'block') return

    if (block.listItem === 'bullet' || block.listItem === 'number') {
      const kind = block.listItem
      // A bullet list followed directly by a numbered list (or vice versa)
      // must not be merged into one element.
      if (listKind && listKind !== kind) flushList()
      listKind = kind
      listBuffer.push(block)
      return
    }

    flushList()
    const content = renderRichTextSpans(block)

    if (block.style === 'h2') {
      elements.push(
        <h2 key={block._key} className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {content}
        </h2>
      )
      return
    }
    if (block.style === 'h3') {
      elements.push(
        <h3 key={block._key} className="text-xl font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {content}
        </h3>
      )
      return
    }
    elements.push(
      <p key={block._key} className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {content}
      </p>
    )
  })

  flushList()

  return <div className="space-y-4">{elements}</div>
}

// ─── CTA Row ──────────────────────────────────────────────────────────────────

function CtaRow({
  section,
}: {
  section: MediaContentSectionType
}) {
  // tenantId and locale are URL params — not stored in Sanity.
  // They're used here to build the correct full path for internal page CTA links.
  const params = useParams()
  const locale = params.locale as string | undefined
  const tenantId = params.tenant as string | undefined

  function withTenantPrefix(resolved: ReturnType<typeof resolveCta>) {
    if (resolved.type !== 'link' || resolved.external || !locale || !tenantId) return resolved
    // href from resolveCta for 'page' type is just "/slug" — prepend locale+tenant
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

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  section: MediaContentSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function MediaContentSection({ section, surface, designSystem }: Props) {
  const {
    eyebrow,
    title,
    body,
    image,
    mediaPosition = 'right',
    mediaStyle: mediaStyleKey,
    contentRatio,
    verticalAlignment,
    reverseOnMobile,
  } = section

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Resolve image URL
  const imageSrc = imageUrl(image, 1200)

  // Resolve media style from DS
  const resolvedStyle = resolveMediaStyle(mediaStyleKey, designSystem?.mediaStyles)
  const hasFixedAspect = resolvedStyle.aspectRatio && resolvedStyle.aspectRatio !== 'auto'
  const imgContainerStyle: React.CSSProperties = {
    borderRadius: resolvedStyle.borderRadius ? `${resolvedStyle.borderRadius}px` : undefined,
    // overflow: hidden is always required so the hover zoom doesn't bleed outside the container
    // and so borderRadius clips the image corners correctly
    overflow: 'hidden',
    aspectRatio: hasFixedAspect ? resolvedStyle.aspectRatio : undefined,
  }
  const imgStyle: React.CSSProperties = {
    objectFit: resolvedStyle.objectFit ?? 'cover',
    width: '100%',
    // height: 100% only meaningful when the container has a fixed aspectRatio;
    // for auto-height containers the image should size naturally
    height: hasFixedAspect ? '100%' : 'auto',
    display: 'block',
  }

  // ── Text block (shared across layouts) ────────────────────────────────────
  const textBlock = (
    <SlideUp duration={duration} ease={ease} delay={0} className="flex flex-col justify-center">
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
      {body && (
        <div className="mt-6">
          <RichText blocks={body} />
        </div>
      )}
      <CtaRow section={section} />
    </SlideUp>
  )

  // ── Media block ───────────────────────────────────────────────────────────
  // The container div carries the "group" class so the hover zoom on the <img>
  // triggers when the user hovers the image area — not the whole section column.
  const mediaBlock = imageSrc ? (
    <SlideUp duration={duration} ease={ease} delay={0.1} className="flex items-center justify-center">
      <div style={imgContainerStyle} className="group w-full">
        <img
          src={imageSrc}
          alt={title ?? ''}
          loading="lazy"
          style={imgStyle}
          className={IMAGE_HOVER_CLASSES}
        />
      </div>
    </SlideUp>
  ) : null

  // ── Layout: none / text-only ──────────────────────────────────────────────
  if (mediaPosition === 'none' || !imageSrc) {
    return (
      <SectionContainer style={surfaceStyles}>
        <div className="grid gap-12 md:grid-cols-2 md:gap-20 lg:gap-28">
          <SlideUp duration={duration} ease={ease} delay={0} className="flex flex-col justify-center">
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
          </SlideUp>
          <SlideUp duration={duration} ease={ease} delay={0.1} className="flex flex-col justify-center">
            {body && <RichText blocks={body} />}
            <CtaRow section={section} />
          </SlideUp>
        </div>
      </SectionContainer>
    )
  }

  // ── Layout: top / bottom (stacked) ────────────────────────────────────────
  if (mediaPosition === 'top' || mediaPosition === 'bottom') {
    return (
      <SectionContainer style={surfaceStyles}>
        <div className="flex flex-col gap-10 lg:gap-14">
          {mediaPosition === 'top' ? mediaBlock : null}
          {textBlock}
          {mediaPosition === 'bottom' ? mediaBlock : null}
        </div>
      </SectionContainer>
    )
  }

  // ── Layout: left / right (side-by-side) ───────────────────────────────────
  const mediaOnLeft = mediaPosition === 'left'
  const cols = gridColsClass(contentRatio, mediaOnLeft)
  const align = alignItemsClass(verticalAlignment)

  // reverseOnMobile: on mobile (below md breakpoint), show text first regardless of desktop order
  // We achieve this with CSS order: media gets order-1 on mobile when reversed, text gets order-0
  const textOrder = reverseOnMobile ? 'order-first md:order-none' : ''
  const mediaOrder = reverseOnMobile ? 'order-last md:order-none' : ''

  return (
    <SectionContainer style={surfaceStyles}>
      <div className={`grid gap-12 ${cols} md:gap-16 lg:gap-24 ${align}`}>
        {/* On desktop: media position drives order. On mobile: reverseOnMobile controls order. */}
        <div className={mediaOnLeft ? mediaOrder : textOrder}>
          {mediaOnLeft ? mediaBlock : textBlock}
        </div>
        <div className={mediaOnLeft ? textOrder : mediaOrder}>
          {mediaOnLeft ? textBlock : mediaBlock}
        </div>
      </div>
    </SectionContainer>
  )
}
