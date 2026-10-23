// ── CatalogueItemCard — one item as a grid card on the website ────────────────
//
// Used for every profile whose registry entry says `website.layout: 'card'`
// (books, products). Reusable across tenants: nothing here knows a tenant.
//
//   cover / photo    book: 2:3, shown whole (never cropped); others: square
//   title            the item page link — stretched over the whole card, so a
//                    click anywhere on the card opens the item (C6: only when
//                    the item has a page in this locale)
//   secondary line   book: "author · year"; others: the byline
//   description      clamped to three lines (the full text is on the item page)
//   tags             up to three small chips
//   price            only when shown and the item has no Amazon link
//   buy              one "Buy on Amazon" button above the stretched link
//
// Server component; all text comes from content or the messages bundle.

import { createElement } from 'react'
import Link from 'next/link'
import type { ResolvedImage } from '@/lib/sanity/types'
import type { CatalogueItemDTO } from '@/lib/modules/catalogue/dto'
import { imageUrl } from '@/lib/sanity/image'
import { catalogueImageShape, itemSecondaryLine } from '@/lib/modules/catalogue/list-model'
import { itemHasAmazonLink } from '@/lib/modules/catalogue/amazon-delivery'
import { CardBuyLink, OfferList, OptionsSummary, TagChips } from './CatalogueItemParts'
import type { CatalogueWebsiteMessages } from './messages'
import type { CatalogueDisplay } from './CatalogueCollectionView'

export function CatalogueItemCard({
  item,
  display,
  messages,
  href,
  headingLevel = 3,
}: {
  item: CatalogueItemDTO
  display: CatalogueDisplay
  messages: CatalogueWebsiteMessages
  href: string | null
  headingLevel?: 2 | 3 | 4 | 5 | 6
}) {
  const portrait = catalogueImageShape({ itemProfile: item.itemProfile }) === 'portrait'
  const image = item.images[0]
  const src = image ? imageUrl(image.image as unknown as ResolvedImage, 600) : undefined
  const secondary = itemSecondaryLine({ itemProfile: item.itemProfile, byline: item.byline, author: item.bookDetails?.author, year: item.bookDetails?.year })
  const hasBuy = item.links.some((l) => l.kind === 'buy')
  const title = href ? (
    // The stretched link: its ::after covers the whole card (the card is `relative`).
    <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none" data-card-link="">
      {item.name}
    </Link>
  ) : (
    item.name
  )
  return (
    <article
      className="group relative flex h-full flex-col rounded-[var(--radius-md,0.5rem)] focus-within:ring-2 focus-within:ring-offset-4"
      style={{ ['--tw-ring-color' as string]: 'var(--color-text-primary)', ['--tw-ring-offset-color' as string]: 'var(--color-background)' }}
      data-item={item.publicId ?? undefined}
      data-item-card=""
    >
      <div
        className={`${portrait ? 'aspect-[2/3]' : 'aspect-square'} w-full overflow-hidden rounded-[var(--radius-md,0.5rem)]`}
        style={{ backgroundColor: 'var(--color-surface, transparent)' }}
      >
        {src && (
          <img
            src={src}
            alt={image.alt ?? ''}
            loading="lazy"
            className={`h-full w-full ${portrait ? 'object-contain' : 'object-cover'} transition-transform duration-300 group-hover:scale-[1.02]`}
            style={portrait ? undefined : { objectPosition: image.objectPosition }}
          />
        )}
      </div>
      <div className="mt-4 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          {createElement(
            `h${headingLevel}`,
            {
              className: 'text-lg font-semibold leading-snug underline-offset-4 group-hover:underline',
              style: { color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' },
            },
            title,
          )}
          {display.showPrices && !itemHasAmazonLink(item) && <OfferList offers={item.offers} m={messages} className="shrink-0" />}
        </div>
        {secondary && (
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
            {secondary}
          </p>
        )}
        {item.description && (
          <p className="mt-2 line-clamp-3 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
            {item.description}
          </p>
        )}
        {/* Choices such as size or colour, as on the row (products). */}
        <OptionsSummary lists={item.optionLists} m={messages} showPrices={display.showPrices} allergens={display.allergens} />
        {item.tags.length > 0 && (
          <div className="mt-3">
            <TagChips tags={item.tags} label={messages.tagsHeading} />
          </div>
        )}
        {hasBuy && <CardBuyLink links={item.links} siteHosts={display.siteHosts} m={messages} shopOrder={display.shopOrder} />}
      </div>
    </article>
  )
}
