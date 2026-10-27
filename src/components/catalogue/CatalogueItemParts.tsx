// ── Catalogue item parts (ADR-033; spec §10.5 website column) ──────────────────
//
// Presentation only, server-rendered, no fetching. Every visual value is a
// design-system token (CSS variable); every user-facing word comes from the
// DTO (tenant content, already locale-resolved) or from catalogue messages.
// Shared by the listing section, the collection page and the item page so the
// three cannot drift apart.

import { opensInNewTab } from '@/lib/links/link-target'
import type {
  CatalogueItemDTO,
  CatalogueItemLinkDTO,
  CatalogueOfferDTO,
  CatalogueOptionDTO,
  CatalogueOptionListDTO,
  CatalogueTermDTO,
} from '@/lib/modules/catalogue/dto'
import { buyLabel, catalogueLinkRel } from '@/lib/modules/catalogue/affiliate'
import { editionLabel, editionLanguageName, editionLinks, orderBuyLinks, shopOfUrl } from '@/lib/modules/catalogue/editions'
import type { AffiliateShopId } from '@/lib/affiliate/shops'
import { shopById } from '@/lib/affiliate/shops'
import { sortByShopOrder } from '@/lib/modules/catalogue/shop-delivery'
import { fillMessage, optionRuleText, type CatalogueWebsiteMessages } from './messages'
import { multiline } from '@/lib/multiline-text'

/** F-1 — the short line under an item's name. Plain text, never parsed. */
export function Byline({ byline, className }: { byline: string | null; className?: string }) {
  if (!byline) return null
  return (
    <p className={className ?? 'mt-0.5 text-sm'} style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }} data-byline="">
      {byline}
    </p>
  )
}

/**
 * F-2 — an item's links. External links follow the platform new-tab rule
 * (src/lib/links/link-target.ts: `opensInNewTab`); a new tab always carries
 * rel="noopener noreferrer". `compact` is the one-line form for cards. Never
 * embeds anything from the address.
 */
export function ItemLinks({
  links,
  siteHosts = [],
  compact,
  heading,
  m,
  shopOrder,
}: {
  links: readonly CatalogueItemLinkDTO[]
  siteHosts?: readonly string[]
  compact: boolean
  /** catalogue.website.linksHeading — labels the list on the item page. */
  heading?: string
  /** Card form only: lets a book with several editions show ONE buy link (the visitor's language first). */
  m?: CatalogueWebsiteMessages
  /** The tenant's shop order: the card's one buy link is the first shop of the visitor's edition. */
  shopOrder?: readonly AffiliateShopId[]
}) {
  if (compact && m && editionLinks(links).length >= 2) {
    const primary = orderBuyLinksByShop(links, m.locale, shopOrder)[0]
    links = links.filter((l) => l.kind !== 'buy' || l === primary)
  }
  if (links.length === 0) return null
  const items = links.map((l) => {
    const blank = opensInNewTab({ href: l.url }, siteHosts)
    return (
      <li key={l.key}>
        <a
          href={l.url}
          className="underline underline-offset-4"
          style={{ color: compact ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}
          {...(blank ? { target: '_blank' } : {})}
          {...relProps(l, blank)}
        >
          {compact && m && l.edition && l.kind === 'buy' ? buyText(l, m, false) : l.label}
        </a>
      </li>
    )
  })
  return (
    <ul
      className={compact ? 'mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm' : 'flex flex-col gap-2 text-base'}
      aria-label={heading || undefined}
      data-item-links=""
    >
      {items}
    </ul>
  )
}

function relProps(l: CatalogueItemLinkDTO, blank: boolean): { rel?: string } {
  const rel = catalogueLinkRel(l, blank)
  return rel ? { rel } : {}
}

/**
 * Amendment K — an item's buy links as prominent buttons (item page only; cards
 * keep the one-line list). The label is the link's own, else the localized
 * "Buy". An affiliate link carries rel="sponsored nofollow noopener noreferrer"
 * and a small localized marker under the button.
 */
export function BuyLinks({ links, siteHosts = [], m, shopOrder }: { links: readonly CatalogueItemLinkDTO[]; siteHosts?: readonly string[]; m: CatalogueWebsiteMessages; shopOrder?: readonly AffiliateShopId[] }) {
  // Book editions: with two or more edition links, one button per edition, the visitor's language first.
  const buy = orderBuyLinks(links, m.locale)
  if (buy.length === 0) return null
  const entries = buyEntries(buy, shopOrder)
  // Several shops for one edition: that edition becomes one row (label, then one button per shop).
  // Links without an edition always render as before (their own labels).
  if (entries.some((e) => e.kind === 'group' && e.links.length >= 2)) {
    return (
      <ul className="flex flex-col items-start gap-y-5" data-buy-links="" data-buy-groups="">
        {entries.map((e) =>
          e.kind === 'group' ? (
            <li key={e.key} className="flex flex-wrap items-start gap-x-4 gap-y-3" data-buy-group="">
              <span className="py-3.5 text-base font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }} data-buy-group-label="">
                {editionLabel(e.edition, m.editionOriginal)}
              </span>
              {e.links.map((l) => (
                <div key={l.key} className="flex flex-col items-start gap-1.5">
                  <BuyButton l={l} siteHosts={siteHosts} text={l.shop ? shopById(l.shop).name : buyLabel(l.label, m.buyDefault)} m={m} />
                </div>
              ))}
            </li>
          ) : (
            <li key={e.l.key} className="flex flex-col items-start gap-1.5">
              <BuyButton l={e.l} siteHosts={siteHosts} text={buyText(e.l, m, false)} m={m} />
            </li>
          ),
        )}
      </ul>
    )
  }
  const manyEditions = editionLinks(buy).length >= 2
  return (
    <ul className="flex flex-wrap items-start gap-x-6 gap-y-4" data-buy-links="">
      {buy.map((l) => (
        <li key={l.key} className="flex flex-col items-start gap-1.5">
          <BuyButton l={l} siteHosts={siteHosts} text={buyText(l, m, manyEditions)} m={m} />
        </li>
      ))}
    </ul>
  )
}

export function BuyButton({ l, siteHosts, text, m, size = 'large', marker = true }: { l: CatalogueItemLinkDTO; siteHosts: readonly string[]; text: string; m: CatalogueWebsiteMessages; /** 'small' on listing cards. */ size?: 'large' | 'small'; /** The small "Affiliate link" note under the button. Off on listing cards: the page's disclosure covers them. */ marker?: boolean }) {
  const blank = opensInNewTab({ href: l.url }, siteHosts)
  return (
    <>
      <a
        href={l.url}
        className={`inline-flex items-center gap-2 font-semibold tracking-wide transition-all duration-200 hover:opacity-90 ${size === 'small' ? 'px-5 py-2.5 text-sm' : 'px-8 py-3.5 text-base'}`}
        style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderRadius: 'var(--radius-btn)' }}
        data-buy-link=""
        {...(blank ? { target: '_blank' } : {})}
        {...relProps(l, blank)}
      >
        {text}
      </a>
      {marker && l.affiliate && m.affiliateMarker && (
        <span className="text-xs" style={MUTED} data-affiliate-marker="">{m.affiliateMarker}</span>
      )}
    </>
  )
}

type BuyEntry = { kind: 'group'; key: string; edition: { language: string; original: boolean }; links: CatalogueItemLinkDTO[] } | { kind: 'link'; l: CatalogueItemLinkDTO }

/**
 * Edition links grouped by LANGUAGE (first appearance first; the group is "Original" when any of its links is),
 * shops inside a group in the tenant's order. Links without an edition stay individual, in place.
 */
function buyEntries(buy: readonly CatalogueItemLinkDTO[], order: readonly AffiliateShopId[] | undefined): BuyEntry[] {
  const entries: BuyEntry[] = []
  for (const l of buy) {
    if (!l.edition) {
      entries.push({ kind: 'link', l })
      continue
    }
    const lang = l.edition.language
    const g = entries.find((e): e is Extract<BuyEntry, { kind: 'group' }> => e.kind === 'group' && e.key === lang)
    if (g) {
      g.links.push(l)
      if (l.edition.original) g.edition = { language: lang, original: true }
    } else entries.push({ kind: 'group', key: lang, edition: { language: lang, original: l.edition.original }, links: [l] })
  }
  return entries.map((e) => (e.kind === 'group' ? { ...e, links: sortByShopOrder(e.links, order) } : e))
}

/** orderBuyLinks, then the shops of each edition in the tenant's order (the first entry is the card's one link). */
export function orderBuyLinksByShop(links: readonly CatalogueItemLinkDTO[], locale: string | undefined, order: readonly AffiliateShopId[] | undefined): CatalogueItemLinkDTO[] {
  return buyEntries(orderBuyLinks(links, locale), order).flatMap((e) => (e.kind === 'group' ? e.links : [e.l]))
}

/**
 * The words on a buy button. Several editions: the language's own name (+ "Original"). One edition (or none):
 * the usual label, with the language as a small secondary part ("Buy · English").
 */
function buyText(l: CatalogueItemLinkDTO, m: CatalogueWebsiteMessages, manyEditions: boolean): string {
  if (l.edition && manyEditions) return editionLabel(l.edition, m.editionOriginal)
  const base = buyLabel(l.label, m.buyDefault)
  return l.edition ? `${base} · ${editionLanguageName(l.edition.language)}` : base
}

/** Amendment K — the catalogue's affiliate disclosure, once per page, below the content. `text` null = render nothing. */
export function AffiliateDisclosure({ text, amazonStatement, className }: { text: string | null; /** Amazon's required sentence; pass only when an Amazon affiliate link renders. */ amazonStatement?: string | null; className?: string }) {
  if (!text && !amazonStatement) return null
  return (
    <p className={className ?? 'mt-12 text-sm leading-relaxed'} style={MUTED} data-affiliate-disclosure="">
      {text}
      {text && amazonStatement ? ' ' : null}
      {amazonStatement ? <span data-amazon-statement="">{amazonStatement}</span> : null}
    </p>
  )
}

/** One offer: channel label, amount (or the localized "Free"), note. */
export function OfferPrice({ offer, m, showChannel }: { offer: CatalogueOfferDTO; m: CatalogueWebsiteMessages; showChannel: boolean }) {
  const amount = offer.isFree ? m.free : offer.formattedPrice
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-offer={offer.key}>
      {showChannel && offer.channelLabel && (
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{offer.channelLabel}</span>
      )}
      {offer.priceNote && (
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{offer.priceNote}</span>
      )}
      <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{amount}</span>
    </span>
  )
}

/** Every offer of an item. A single unscoped offer shows no channel label. */
export function OfferList({ offers, m, className }: { offers: readonly CatalogueOfferDTO[]; m: CatalogueWebsiteMessages; className?: string }) {
  if (offers.length === 0) return null
  const showChannel = offers.length > 1 || offers.some((o) => o.channel !== null)
  return (
    <span className={`flex flex-col items-end gap-0.5 text-right ${className ?? ''}`}>
      {offers.map((o) => (
        <OfferPrice key={o.key} offer={o} m={m} showChannel={showChannel} />
      ))}
    </span>
  )
}

/**
 * ADR-033 D-3a — a choice's allergens as real text ("Contains: Milk · May
 * contain: Nuts", or the approved "none declared" wording). null when there is
 * nothing declared to say (not food, a "remove" choice, not reviewed).
 */
export function optionAllergenText(decl: CatalogueOptionDTO['allergenDeclaration'], m: CatalogueWebsiteMessages): string | null {
  if (!decl || decl.status === 'notReviewed') return null
  const parts =
    decl.status === 'noneDeclared' ? (m.allergensNoneDeclared ? [m.allergensNoneDeclared] : []) : [`${m.containsHeading}: ${decl.allergens.map((a) => m.allergen(a)).join(', ')}`]
  if (decl.mayContain.length) parts.push(`${m.mayContainHeading}: ${decl.mayContain.map((a) => m.allergen(a)).join(', ')}`)
  return parts.join(' · ')
}

/** One choice's text: "Without onions", "Extra mozzarella (+€1.50)". */
export function optionLabel(o: CatalogueOptionDTO, m: CatalogueWebsiteMessages, showPrices: boolean): string {
  const label = o.kind === 'remove' ? fillMessage(m.without, { label: o.label }) || o.label : o.label
  return showPrices && o.formattedDelta ? `${label} (${o.formattedDelta})` : label
}

/**
 * "Sides: Fries (+€2), Salad · Without onions" — a summary for listings. Each
 * choice's allergens sit beside it as text (D-3a): inline when compact
 * ("Extra mozzarella — Contains: Milk"), one choice per line when expanded.
 */
export function OptionsSummary({ lists, m, showPrices, allergens = 'compact' }: { lists: readonly CatalogueOptionListDTO[]; m: CatalogueWebsiteMessages; showPrices: boolean; allergens?: 'compact' | 'expanded' }) {
  const visible = lists.filter((l) => l.options.length > 0)
  if (visible.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      {visible.map((l) => {
        const rule = optionRuleText(m, l.min, l.max)
        const head = (
          <>
            {l.name && <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{l.name}</span>}
            {rule && <span> · {rule}</span>}
            {l.name || rule ? ': ' : ''}
          </>
        )
        if (allergens === 'expanded') {
          return (
            <li key={l.key}>
              {head}
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {l.options.map((o) => {
                  const a = optionAllergenText(o.allergenDeclaration, m)
                  return (
                    <li key={o.key} data-option={o.key}>
                      {optionLabel(o, m, showPrices)}
                      {a && <span className="block text-xs" data-option-allergens="">{a}</span>}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        }
        const options = l.options
          .map((o) => {
            const a = optionAllergenText(o.allergenDeclaration, m)
            return a ? `${optionLabel(o, m, showPrices)} — ${a}` : optionLabel(o, m, showPrices)
          })
          .join(', ')
        return (
          <li key={l.key}>
            {head}
            {options}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Dietary tags + the allergen declaration (ADR-033 D-3). Only what was
 * DECLARED is printed — never an inferred claim ("allergen-free", vegan …):
 *   containsListedAllergens → "Allergens: …" and, separately, "May contain: …"
 *   noneDeclared            → messages catalogue.website.allergensNoneDeclared
 *   notReviewed / non-food  → nothing
 * Compact is one line of real text (assistive technology reads exactly what is
 * shown — no icon-only codes); expanded is a labelled list. Labels are
 * platform messages, so they exist in every locale even for untranslated items.
 */
export function AllergensAndDietary({ item, m, compact }: { item: Pick<CatalogueItemDTO, 'allergenDeclaration' | 'dietary'>; m: CatalogueWebsiteMessages; compact: boolean }) {
  const decl = item.allergenDeclaration
  const shown = decl && decl.status !== 'notReviewed' ? decl : null
  const hasDietary = item.dietary.length > 0
  if (!shown && !hasDietary) return null
  return (
    <div className={compact ? 'mt-2 flex flex-col gap-1.5' : 'flex flex-col gap-4'}>
      {hasDietary && <DietaryTags tags={item.dietary} label={m.dietaryHeading} />}
      {shown && <AllergenDeclarationText decl={shown} m={m} compact={compact} />}
    </div>
  )
}

const MUTED = { color: 'var(--color-text-muted, var(--color-text-secondary))' }

function AllergenDeclarationText({ decl, m, compact }: { decl: Exclude<NonNullable<CatalogueItemDTO['allergenDeclaration']>, { status: 'notReviewed' }>; m: CatalogueWebsiteMessages; compact: boolean }) {
  if (decl.status === 'noneDeclared') {
    // E-1: "May contain" on its own line under the reviewed-none statement.
    const mayNone = decl.mayContain.map((a) => m.allergen(a)).join(', ')
    return (
      <p className="text-sm" style={MUTED} data-allergens="none-declared">
        {m.allergensNoneDeclared}
        {mayNone && (
          <span className="block" data-allergens="may-contain">
            {m.mayContainHeading && <span className="font-medium">{m.mayContainHeading}: </span>}
            {mayNone}
          </span>
        )}
        {decl.note ? <span className={multiline()}> · {decl.note}</span> : null}
      </p>
    )
  }
  const contains = decl.allergens.map((a) => m.allergen(a)).join(', ')
  const may = decl.mayContain.map((a) => m.allergen(a)).join(', ')
  if (compact) {
    return (
      <p className="text-sm" style={MUTED} data-allergens="contains">
        {m.allergensHeading && <span className="font-medium">{m.allergensHeading}: </span>}
        {contains}
        {may && (
          <>
            {' · '}
            {m.mayContainHeading && <span className="font-medium">{m.mayContainHeading}: </span>}
            {may}
          </>
        )}
        {decl.note ? <span className={multiline()}> · {decl.note}</span> : null}
      </p>
    )
  }
  return (
    <dl className="flex flex-col gap-2 text-sm" style={MUTED} data-allergens="contains">
      <div>
        <dt className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{m.allergensHeading}</dt>
        <dd>{contains}</dd>
      </div>
      {may && (
        <div>
          <dt className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{m.mayContainHeading}</dt>
          <dd>{may}</dd>
        </div>
      )}
      {decl.note ? <dd className={multiline()}>{decl.note}</dd> : null}
    </dl>
  )
}

/** Slice 7 — the item's tags on its own page: a small, calm list of plain words. Unknown keys never reach here (dropped by the resolver). */
export function ItemTags({ tags, label }: { tags: readonly CatalogueTermDTO[]; label: string }) {
  if (tags.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={label || undefined} style={{ color: 'var(--color-text-secondary)' }}>
      {tags.map((t) => (
        <li key={t.value}>{t.label}</li>
      ))}
    </ul>
  )
}

function DietaryTags({ tags, label }: { tags: readonly CatalogueTermDTO[]; label: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label || undefined}>
      {tags.map((t) => (
        <li
          key={t.value}
          className="rounded-[var(--radius-full,9999px)] border px-2.5 py-0.5 text-xs font-medium"
          style={{
            borderColor: t.color ?? 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * A listing card's one buy action: the first buy link for the visitor (their language's edition first, then the
 * tenant's shop order), worded "Buy on Amazon" when the shop is known, with "3 editions" beside it when the
 * book has several. Sits above the card's stretched link, so it opens the shop, not the item page.
 */
export function CardBuyLink({ links, siteHosts = [], m, shopOrder }: { links: readonly CatalogueItemLinkDTO[]; siteHosts?: readonly string[]; m: CatalogueWebsiteMessages; shopOrder?: readonly AffiliateShopId[] }) {
  const primary = orderBuyLinksByShop(links, m.locale, shopOrder)[0]
  if (!primary) return null
  const shop = shopOfUrl(primary.url)
  const own = primary.label.trim()
  const text = own || (shop && m.buyOn ? fillMessage(m.buyOn, { shop: shop.name }) : buyLabel('', m.buyDefault))
  const languages = new Set(editionLinks(links).map((l) => l.edition!.language)).size
  return (
    <div className="relative z-10 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4" data-card-buy="">
      <BuyButton l={primary} siteHosts={siteHosts} text={text} m={m} size="small" marker={false} />
      {languages >= 2 && m.editionsCount ? (
        <span className="text-xs" style={MUTED} data-card-editions="">
          {fillMessage(m.editionsCount, { count: languages })}
        </span>
      ) : null}
    </div>
  )
}

/** Up to `max` tags as small chips (listing cards). */
export function TagChips({ tags, label, max = 3 }: { tags: readonly CatalogueTermDTO[]; label: string; max?: number }) {
  const shown = tags.slice(0, max)
  if (shown.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label || undefined} data-card-tags="">
      {shown.map((t) => (
        <li
          key={t.value}
          className="rounded-[var(--radius-full,9999px)] border px-2.5 py-0.5 text-xs"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          {t.label}
        </li>
      ))}
    </ul>
  )
}
