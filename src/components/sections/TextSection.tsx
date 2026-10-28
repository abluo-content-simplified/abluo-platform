import type { TextSection, PortableTextContent, PortableTextBlock, DesignSystem } from '@/lib/sanity/types'
import { safeLinkHref } from '@/lib/links/safe-href'
import { opensInNewTab } from '@/lib/links/link-target'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { FadeIn } from '@/components/animation/FadeIn'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import type { ResolvedImage } from '@/lib/sanity/types'

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
    // Unsafe or malformed hrefs render as plain text (src/lib/links/safe-href.ts).
    const href = linkDef ? safeLinkHref(linkDef.href) : null
    if (href) {
      // New-tab rule + the link's own `blank` override (src/lib/links/link-target.ts).
      const external = opensInNewTab({ href, blank: (linkDef as { blank?: unknown }).blank })
      node = (
        <a
          href={href}
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

function RichText({ blocks }: { blocks: PortableTextContent }) {
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
        <h2
          key={block._key}
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h3, 1.5rem)', fontWeight: 'var(--font-weight-h3, 600)', lineHeight: 'var(--line-height-h3, 2rem)' }}
        >
          {content}
        </h2>
      )
      return
    }
    elements.push(
      <p
        key={block._key}
        className="text-base leading-relaxed"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {content}
      </p>
    )
  })

  flushList()

  return <div className="space-y-4">{elements}</div>
}

interface Props {
  section: TextSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function TextSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, content, image, imageAlt } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  // Optional image beside the text. GROQ delivers the side as `mediaPosition`
  // (coalesce(mediaPosition, imagePosition)); the raw field is read too so a
  // caller handing over an unprojected section still works. Default: right.
  const hasImage = Boolean(image?.asset)
  const imageOnLeft = hasImage && (section.mediaPosition ?? section.imagePosition) === 'left'

  const textInner = (
    <>
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
        {content && (
          <SlideUp duration={duration} ease={ease} delay={0.1}>
            <RichText blocks={content} />
          </SlideUp>
        )}
    </>
  )

  if (!hasImage) {
    // Text-only — the exact markup this section has always rendered.
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <div className="max-w-[680px]">
        {textInner}
        </div>
      </SectionContainer>

    )
  }

  // Two columns on desktop (text ~7/12, image ~5/12), stacked on phones with
  // the image AFTER the text whichever side it sits on at desktop. Same image
  // treatment as statementSection (rounded radius-lg, cover, Sanity srcSet),
  // plus the hotspot as object-position so the crop keeps the subject.
  return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <div
          className={`flex flex-col gap-12 md:grid md:items-center md:gap-16 lg:gap-24 ${
            imageOnLeft ? 'md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'
          }`}
        >
          <div className="max-w-[680px]">{textInner}</div>
          <FadeIn duration={duration} ease={ease} delay={0.12} className={imageOnLeft ? 'md:order-first' : undefined}>
            <div
              className="relative w-full overflow-hidden rounded-[var(--radius-lg)]"
              style={{ aspectRatio: '4 / 5' }}
            >
              <img
                src={imageUrl(image as ResolvedImage, 1200) ?? ''}
                srcSet={imageSrcSet(image as ResolvedImage, [600, 900, 1200, 1600])}
                sizes="(max-width: 768px) 100vw, 42vw"
                alt={imageAlt ?? ''}
                className="h-full w-full object-cover"
                style={{ objectPosition: focalObjectPosition(image as ResolvedImage) }}
                loading="lazy"
                decoding="async"
              />
            </div>
          </FadeIn>
        </div>
      </SectionContainer>

  )
}
