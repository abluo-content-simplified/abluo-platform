// ── Catalogue — pure validation helpers (spec §11) ────────────────────────────
//
// Authority: ADR-033 D7 (currency-change warning), D11 (one slug namespace
// across items AND collections). Nothing here fetches: documents are passed in,
// and the GROQ each helper needs is exported as a string next to it so the
// caller (and a test) can see exactly what runs.
//
// Not duplicated here, by design:
//   - overlapping availability within a scope  → offers.ts `offerIssues`
//   - slug normalisation and the raw conflict scan → slugs.ts

import { normalise, slugConflicts, type SlugOwner } from './slugs'

const baseId = (id: string) => id.replace(/^drafts\./, '')

// ── Slug uniqueness (D11) ─────────────────────────────────────────────────────

/** A raw row from SLUG_NAMESPACE_QUERY. `slug` is the whole localizedSlug object. */
export type SlugRow = {
  _id: string
  _type: string
  hasPage?: boolean | null
  /** Any localized text value of the document's name — a map of locale → string. */
  label?: Record<string, unknown> | null
  slug?: Record<string, unknown> | null
}

/** A namespace member that can be NAMED in a refusal. */
export type NamedSlugOwner = SlugOwner & { label: string }

/**
 * Every item and collection of the project that takes part in the slug
 * namespace. Raw perspective so draft-only documents reserve their slug too
 * (slugs stay reserved while a document exists — spec §9), and ARCHIVED ones
 * are deliberately included: restore + republish must return the same URL.
 */
export const SLUG_NAMESPACE_QUERY = `*[_type in ["catalogueItem", "catalogueCollection"] && projectSlug == $projectSlug && hasPage == true]{
  _id, _type, hasPage, "label": name, slug
}`

export function slugNamespaceParams(projectSlug: string): { projectSlug: string } {
  return { projectSlug }
}

/** First non-empty text in a localized object (or the plain string itself). */
export function labelOf(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!k.startsWith('_') && typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return fallback
}

/**
 * Query rows → namespace members. A published document and its draft are ONE
 * member (the draft wins: it is what will be published next); `localizedSlug`
 * values are read as `slug[locale].current`.
 */
export function toSlugOwners(rows: readonly SlugRow[]): NamedSlugOwner[] {
  const byId = new Map<string, SlugRow>()
  for (const row of rows) {
    const id = baseId(row._id)
    const prev = byId.get(id)
    if (!prev || row._id.startsWith('drafts.')) byId.set(id, row)
  }
  return [...byId].map(([id, row]) => {
    const slugs: Record<string, string | null> = {}
    for (const [locale, v] of Object.entries(row.slug ?? {})) {
      if (locale.startsWith('_')) continue
      const current = (v as { current?: unknown } | null)?.current
      slugs[locale] = typeof current === 'string' ? current : null
    }
    return {
      id,
      type: row._type === 'catalogueCollection' ? 'collection' : 'item',
      hasPage: row.hasPage === true,
      slugs,
      label: labelOf(row.label, id),
    }
  })
}

export type NamedSlugConflict = {
  locale: string
  slug: string
  /** The document already using it — named, not just refused (spec §11). */
  owner: { id: string; type: 'item' | 'collection'; label: string }
}

/**
 * Slug conflicts of a candidate, each naming the document that holds the slug.
 * Items and collections share the namespace, per locale; the same slug in two
 * different locales is not a conflict. A candidate without a page (`hasPage`
 * false) claims nothing.
 */
export function namedSlugConflicts(
  candidate: { id: string; hasPage: boolean; slugs: Readonly<Record<string, string | null | undefined>> },
  existing: readonly NamedSlugOwner[],
): NamedSlugConflict[] {
  if (!candidate.hasPage) return []
  const id = baseId(candidate.id)
  const labels = new Map(existing.map((o) => [o.id, o.label]))
  return slugConflicts({ id, slugs: candidate.slugs }, existing).map((c) => ({
    locale: c.locale,
    slug: c.slug,
    owner: { ...c.owner, label: labels.get(c.owner.id) ?? c.owner.id },
  }))
}

// ── Currency-change impact (D7) ───────────────────────────────────────────────

export type ItemPriceRow = { _id: string; prices?: readonly unknown[] | null }
export type OptionListRow = { _id: string; deltas?: readonly unknown[] | null }

/** Offer prices of every item of the project (published and draft copies; deduplicated below). */
export const CURRENCY_ITEM_PRICES_QUERY = `*[_type == "catalogueItem" && projectSlug == $projectSlug]{ _id, "prices": offers[defined(price)].price }`
/** Non-zero option price changes of every option list of the project. */
export const CURRENCY_OPTION_DELTAS_QUERY = `*[_type == "catalogueOptionList" && projectSlug == $projectSlug]{ _id, "deltas": options[defined(priceDelta) && priceDelta != 0].priceDelta }`

export type CurrencyImpact = {
  /** Offer prices that will be read in the new currency. */
  prices: number
  /** Items carrying at least one of them. */
  items: number
  /** Non-zero option price changes ("+1.50 for extra mozzarella") reinterpreted the same way. */
  optionDeltas: number
  optionLists: number
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * How much stored money a currency change reinterprets (nothing is converted).
 *
 * The headline of ADR-033 D7 — "147 prices across 38 items" — is `prices` and
 * `items`: offer prices only. Option price changes are amounts too and the
 * change reinterprets them just the same, so they are reported separately
 * (`optionDeltas` / `optionLists`) rather than folded in: the sentence stays
 * exactly true, a default delta of 0 never inflates anything (zeros are not
 * counted), and the UI may append "and 12 option price changes" when non-zero.
 *
 * Every version counts once per document: a draft supersedes its published
 * copy, since the draft is what will be published next. Archived documents
 * count — their amounts reappear on restore.
 */
export function currencyImpact(items: readonly ItemPriceRow[], optionLists: readonly OptionListRow[] = []): CurrencyImpact {
  const latest = <T extends { _id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T>()
    for (const r of rows) if (!m.has(baseId(r._id)) || r._id.startsWith('drafts.')) m.set(baseId(r._id), r)
    return [...m.values()]
  }
  let prices = 0
  let itemCount = 0
  for (const row of latest(items)) {
    const n = (row.prices ?? []).filter(isAmount).length
    prices += n
    if (n > 0) itemCount++
  }
  let optionDeltas = 0
  let listCount = 0
  for (const row of latest(optionLists)) {
    const n = (row.deltas ?? []).filter((d) => isAmount(d) && d !== 0).length
    optionDeltas += n
    if (n > 0) listCount++
  }
  return { prices, items: itemCount, optionDeltas, optionLists: listCount }
}

/** True when a currency change reinterprets anything — i.e. the confirmation is needed. */
export function currencyChangeNeedsConfirmation(impact: CurrencyImpact): boolean {
  return impact.prices > 0 || impact.optionDeltas > 0
}

/** Case-insensitive compare of ISO 4217 codes — "eur" → "EUR" is no change. */
export function currencyChanged(from: string | null | undefined, to: string | null | undefined): boolean {
  return normalise(from).toUpperCase() !== normalise(to).toUpperCase()
}
