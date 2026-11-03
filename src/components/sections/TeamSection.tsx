import type { TeamSection, PortableTextContent, PortableTextBlock, DesignSystem } from '@/lib/sanity/types'
import { safeLinkHref } from '@/lib/links/safe-href'
import { opensInNewTab } from '@/lib/links/link-target'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { getTeamSectionMessages } from '@/lib/i18n/team-section-messages'
import { getPeopleMessages } from '@/lib/i18n/people-messages'
import { PeopleGrid } from '@/components/people/PeopleGrid'
import { memberToCardData, personToCardData, type PersonCardData } from '@/components/people/PersonCard'
import { isPeopleModuleOn, profileSegmentFor, teamSource } from '@/lib/modules/people/website'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import { siteBasePath } from '@/lib/sanity/href'

interface Props {
  section: TeamSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** Page locale — picks the dictionary label for member website links. */
  locale?: string
  /**
   * ADR-043 — the People module gates ref rendering exactly like module
   * sections are gated (null/absent = unresolved = available). Not installed:
   * the section shows its inline `members`, as before.
   */
  enabledModuleIds?: string[] | null
  /** Module config — the People profile segment (per language). */
  moduleConfig?: ProjectModuleConfig
  /** URL project segment + host scope, for profile links. */
  tenantSlug?: string
  hostScoped?: boolean
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

    elements.push(
      <p key={block._key} className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {content}
      </p>
    )
  })

  flushList()

  return <div className="space-y-3">{elements}</div>
}

export function TeamSection({ section, surface, designSystem, locale, enabledModuleIds, moduleConfig, tenantSlug, hostScoped }: Props) {
  const { title, subtitle, intro, members } = section
  const msg = getTeamSectionMessages(locale)

  // ADR-043 / CONTRACTS §6.3 — peopleCount > 0 ⇒ the hand-picked people; else a
  // group filter ⇒ that group; else the inline members. Both end up as the same
  // card view model, so they render with identical markup.
  const source = teamSource(section, isPeopleModuleOn(enabledModuleIds))
  const profileLinks =
    locale && tenantSlug
      ? { siteBase: siteBasePath(locale, tenantSlug, hostScoped), segment: profileSegmentFor(moduleConfig, locale) }
      : null
  const cards: PersonCardData[] =
    source.kind === 'people'
      ? source.people.map((p) => personToCardData(p, profileLinks))
      : (members ?? []).map(memberToCardData)
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
      <PeopleGrid cards={cards} msg={msg} profileLabel={getPeopleMessages(locale).viewProfile} duration={duration} ease={ease} />
    </SectionContainer>
  )
}
