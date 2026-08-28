import type { TextSection, PortableTextContent, PortableTextBlock, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'

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
          className="text-2xl font-semibold"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
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
  const { eyebrow, title, content } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  return (
      <SectionContainer style={surfaceStyles}>
        <div className="max-w-[680px]">
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
        {content && (
          <SlideUp duration={duration} ease={ease} delay={0.1}>
            <RichText blocks={content} />
          </SlideUp>
        )}
        </div>
      </SectionContainer>

  )
}
