// ── CatalogueCollectionView — one collection's section tree ───────────────────
//
// Spec AC 18/19/20d: parents before children in stored order (the DTO is
// already in reading order), a parent with no items of its own still prints
// its heading, and recovered orphans/cycle members arrive as roots (ADR-033
// A7) and render like any other root — nothing disappears.
//
// Items link to their own page ONLY when `itemHref` returns one (C6: hasPage +
// a slug in the request locale). Otherwise the item renders unlinked.
//
// Server component. Motion is the design system's (durationSlow / easing
// tokens) through SlideUp; nothing about timing is stored in content.

import { createElement } from 'react'
import Link from 'next/link'
import type { DesignSystem, ResolvedImage } from '@/lib/sanity/types'
import type { CatalogueCollectionDTO, CatalogueItemDTO, CatalogueSectionDTO } from '@/lib/modules/catalogue/dto'
import { imageUrl } from '@/lib/sanity/image'
import { resolveEasing } from '@/lib/motion/easing'
import { SlideUp } from '@/components/animation/SlideUp'
import { AllergensAndDietary, OfferList, OptionsSummary } from './CatalogueItemParts'
import type { CatalogueWebsiteMessages } from './messages'

export type CatalogueDisplay = {
  showPrices: boolean
  /**
   * ADR-033 D-3: how a food item's allergen declaration is shown. There is no
   * "hidden" — wherever a food item is presented publicly, its declaration is.
   */
  allergens: 'compact' | 'expanded'
}

export interface CatalogueCollectionViewProps {
  collection: CatalogueCollectionDTO
  display: CatalogueDisplay
  messages: CatalogueWebsiteMessages
  designSystem: DesignSystem | null
  /** Site-relative href of an item's page, or null (C6). */
  itemHref: (item: CatalogueItemDTO) => string | null
  /** Heading level of a root section (2 under a page h1, 3 under a section h2). */
  rootHeadingLevel?: 2 | 3
}

type HeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

function headingTag(level: number): HeadingTag {
  return (`h${Math.min(Math.max(level, 2), 6)}`) as HeadingTag
}

export function CatalogueCollectionView({
  collection,
  display,
  messages,
  designSystem,
  itemHref,
  rootHeadingLevel = 2,
}: CatalogueCollectionViewProps) {
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  return (
    <div className="flex flex-col gap-14" data-collection={collection.publicId ?? undefined}>
      {collection.sections.map((section) => (
        <SlideUp key={section.key} duration={duration} ease={ease}>
          <SectionBlock
            section={section}
            level={rootHeadingLevel}
            display={display}
            messages={messages}
            itemHref={itemHref}
          />
        </SlideUp>
      ))}
    </div>
  )
}

function SectionBlock({
  section,
  level,
  display,
  messages,
  itemHref,
}: {
  section: CatalogueSectionDTO
  level: number
  display: CatalogueDisplay
  messages: CatalogueWebsiteMessages
  itemHref: (item: CatalogueItemDTO) => string | null
}) {
  const isRoot = section.depth === 0
  return (
    <section
      aria-label={section.name || undefined}
      data-section={section.key}
      className={isRoot ? '' : 'mt-8'}
    >
      {section.name &&
        createElement(
          headingTag(level),
          {
            className: isRoot ? 'mb-6' : 'mb-4',
            style: {
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-heading)',
              fontSize: isRoot ? 'var(--font-size-h3, 1.5rem)' : 'var(--font-size-h4, 1.25rem)',
              fontWeight: isRoot ? 'var(--font-weight-h3, 600)' : 'var(--font-weight-h4, 600)',
              lineHeight: 1.3,
            },
          },
          section.name,
        )}
      {section.items.length > 0 && (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {section.items.map((item, i) => (
            <li
              key={`${item.publicId ?? 'item'}-${i}`}
              className="py-5 first:pt-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <CatalogueItemRow item={item} display={display} messages={messages} href={itemHref(item)} />
            </li>
          ))}
        </ul>
      )}
      {section.children.map((child) => (
        <SectionBlock
          key={child.key}
          section={child}
          level={level + 1}
          display={display}
          messages={messages}
          itemHref={itemHref}
        />
      ))}
    </section>
  )
}

/** One item as a row: optional photo, name (linked per C6), prices, text, options, allergens. */
export function CatalogueItemRow({
  item,
  display,
  messages,
  href,
}: {
  item: CatalogueItemDTO
  display: CatalogueDisplay
  messages: CatalogueWebsiteMessages
  href: string | null
}) {
  const image = item.images[0]
  const thumb = image ? imageUrl(image.image as unknown as ResolvedImage, 240) : undefined
  const name = (
    <span
      className="text-lg font-semibold"
      style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
    >
      {item.name}
    </span>
  )
  return (
    <article className="flex gap-4" data-item={item.publicId ?? undefined}>
      {thumb && (
        <img
          src={thumb}
          alt={image.alt ?? ''}
          width={96}
          height={96}
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-[var(--radius-md,0.5rem)] object-cover sm:h-24 sm:w-24"
          style={{ objectPosition: image.objectPosition }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          {href ? (
            <Link href={href} className="underline-offset-4 hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {display.showPrices && <OfferList offers={item.offers} m={messages} className="shrink-0" />}
        </div>
        {item.description && (
          <p className="mt-1 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
            {item.description}
          </p>
        )}
        <OptionsSummary lists={item.optionLists} m={messages} showPrices={display.showPrices} allergens={display.allergens} />
        <AllergensAndDietary item={item} m={messages} compact={display.allergens === 'compact'} />
      </div>
    </article>
  )
}
