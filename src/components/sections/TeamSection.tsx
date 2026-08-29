import type { TeamSection, PortableTextContent, PortableTextBlock, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: TeamSection
  surface: SurfaceType
  designSystem: DesignSystem | null
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

    elements.push(
      <p key={block._key} className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {content}
      </p>
    )
  })

  flushList()

  return <div className="space-y-3">{elements}</div>
}

export function TeamSection({ section, surface, designSystem }: Props) {
  const { title, subtitle, intro, members } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {/* Section header */}
      <SlideUp duration={duration} ease={ease} delay={0} className="mb-16 max-w-2xl">
        {subtitle && (
          <EyebrowLabel
            eyebrow={subtitle}
            designSystem={designSystem}
            defaultAccent="none"
            className="mb-4"
          />
        )}
        {title && (
          <h2
            className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
          >
            {title}
          </h2>
        )}
        {intro && intro.length > 0 && (
          <div className="mt-6">
            <RichText blocks={intro} />
          </div>
        )}
        <div className="mt-6 h-[1px] w-12" style={{ backgroundColor: 'var(--color-border)' }} />
      </SlideUp>

      {/* Members grid — 1 col → 2 col (sm) → 3 col (lg) → 4 col (xl) */}
      {members && members.length > 0 && (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {members.map((member, index) => {
            const src = imageUrl(member.photo, 600)
            const srcSet = imageSrcSet(member.photo, [300, 600, 900])

            return (
              <SlideUp key={member._key} duration={duration} ease={ease} delay={index * 0.07}>
                <div className="group flex flex-col">
                  {/* Photo or initials placeholder */}
                  <div
                    className="relative mb-6 w-full overflow-hidden"
                    style={{
                      aspectRatio: '3 / 4',
                      backgroundColor: 'var(--color-surface)',
                      // Border radius uses the DS token — will become a DS media token in future
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    {src ? (
                      <img
                        src={src}
                        srcSet={srcSet}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                        alt={member.name}
                        className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span
                          className="text-3xl font-light"
                          style={{ color: 'var(--color-text-muted)' }}
                          aria-hidden="true"
                        >
                          {member.name
                            .split(' ')
                            .filter((w) => w.length > 1)
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <p
                    className="mb-1 text-base font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {member.name}
                  </p>

                  {/* Role */}
                  {member.role && (
                    <p
                      className="mb-4 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {member.role}
                    </p>
                  )}

                  {/* Divider */}
                  <div
                    className="mb-4 h-[1px] w-8 transition-all duration-300 group-hover:w-14"
                    style={{ backgroundColor: 'var(--color-border)' }}
                  />

                  {/* Bio */}
                  {member.bio && (
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {member.bio}
                    </p>
                  )}
                </div>
              </SlideUp>
            )
          })}
        </div>
      )}
    </SectionContainer>
  )
}
