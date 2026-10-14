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
import { fillMessage, optionRuleText, type CatalogueWebsiteMessages } from './messages'

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
}: {
  links: readonly CatalogueItemLinkDTO[]
  siteHosts?: readonly string[]
  compact: boolean
  /** catalogue.website.linksHeading — labels the list on the item page. */
  heading?: string
}) {
  if (links.length === 0) return null
  const items = links.map((l) => {
    const blank = opensInNewTab({ href: l.url }, siteHosts)
    return (
      <li key={l.key}>
        <a
          href={l.url}
          className="underline underline-offset-4"
          style={{ color: compact ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}
          {...(blank ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {l.label}
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
        {decl.note ? <span> · {decl.note}</span> : null}
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
        {decl.note ? <span> · {decl.note}</span> : null}
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
      {decl.note ? <dd>{decl.note}</dd> : null}
    </dl>
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
