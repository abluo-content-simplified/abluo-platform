// G-03 `adapter-equivalence` (C6 §6.15): the engine-backed `itemIssues` equals
// the pre-R1 implementation (kept verbatim as `legacyItemIssues`) on every
// generated editor state — same ids, severities, steps, tabs, message keys,
// values and focus selectors, in the same order.
import { describe, expect, it } from 'vitest'
import { EMPTY_BOOK_DETAILS, NOT_REVIEWED, emptyFormats, parsePrice, type AttachmentForm, type DeclarationForm, type OfferForm } from '../../dashboard-form'
import type { Format } from '../../commerce/formats'
import type { ChannelKey } from '../../commerce/commerce-types'
import { itemIssues, type ItemIssueContext, type ItemIssueState } from '../../item-issues'
import type { ItemProfile } from '../../profiles'
import { legacyItemIssues } from './legacy-item-issues.oracle'

const PROFILES: Array<ItemProfile | null> = [null, 'product', 'service', 'book', 'foodOrDrink']
const NAMES: Array<Record<string, string>> = [{}, { it: 'Pizza Margherita' }, { it: '!!!' }, { en: 'Only English' }, { it: 'Libro', de: 'Buch' }, { it: '   ' }]
const OFFERS: OfferForm[][] = [
  [],
  [{ key: 'a', channel: null, price: '', availability: [] }],
  [{ key: 'a', channel: null, price: '8.50', availability: [] }],
  [{ key: 'e', channel: null, price: '9', availability: [{ key: 'w', days: ['mon'], from: '25:00', to: '10:00' }] }],
  [{ key: 'f', channel: null, price: '9', availability: [{ key: 'w', days: ['mon'], from: '10:00', to: '' }] }],
  [{ key: 'g', channel: null, price: '9', availability: [{ key: 'w', days: ['mon'], from: '10:00', to: '10:00' }] }],
  [
    { key: 'h', channel: null, price: '9', availability: [] },
    { key: 'i', channel: null, price: '10', availability: [] },
  ],
  [{ key: 'j', channel: 'gone', price: '9', availability: [] }],
  [{ key: 'k', channel: 'delivery', price: '9', availability: [] }],
]

/**
 * R2: the editor edits the C3/C4 model. Every legacy offer form above is one the model can hold (an amount
 * that is a number — the price field never hands text that is not an amount to the state), mapped exactly as
 * the dual-read maps stored offers (C10-3): one implicit format, one price per filled row, keys kept.
 */
function asFormats(offers: readonly OfferForm[]): Format[] {
  const prices = offers
    .filter((o) => o.price.trim() !== '')
    .map((o) => ({
      key: o.key,
      scope: o.channel as ChannelKey | null,
      amount: parsePrice(o.price)!,
      note: null,
      windows: o.availability.filter((a) => a.days.length || a.from || a.to).map((a) => ({ days: a.days, from: a.from || null, to: a.to || null })),
    }))
  return [{ ...emptyFormats()[0], prices }]
}
const OPTIONS: AttachmentForm[][] = [[], [{ key: 'x', listId: 'L', min: 3, max: 1 }], [{ key: 'y', listId: 'GONE', min: 0, max: null }], [{ key: 'z', listId: 'L', min: 0, max: 9 }]]
const DECLS: DeclarationForm[] = [
  NOT_REVIEWED,
  { ...NOT_REVIEWED, status: 'containsListedAllergens' },
  { ...NOT_REVIEWED, status: 'containsListedAllergens', allergens: ['milk'] },
  { ...NOT_REVIEWED, status: 'noneDeclared' },
  { ...NOT_REVIEWED, status: 'noneDeclared', confirmed: true, mayContain: ['fish'] },
]
const ISBNS = ['', '123', '9780306406157', '  ']
const PAGES: Array<Pick<ItemIssueState, 'hasPage' | 'slug'>> = [
  { hasPage: false, slug: {} },
  { hasPage: true, slug: {} },
  { hasPage: true, slug: { it: '!!!' } },
  { hasPage: true, slug: { it: 'pizza' } },
  { hasPage: true, slug: { de: 'buch' } },
  { hasPage: true, slug: { en: 'stray' } },
  { hasPage: false, slug: { de: 'buch' } },
]
const CTXS: ItemIssueContext[] = [
  { defaultLocale: 'it', locales: ['it'], channels: [], optionCounts: new Map([['L', 3]]) },
  { defaultLocale: 'it', locales: ['it', 'de', 'en'], channels: ['delivery'], optionCounts: new Map([['L', 3]]) },
]

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]

/** JSON round-trip: the legacy code wrote `focus: undefined` explicitly; a missing key and an undefined one are the same data. */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x))

describe('G-03 adapter-equivalence', () => {
  it('equals the pre-R1 itemIssues on 4000 generated editor states', () => {
    const r = rng(20261102)
    let nonEmpty = 0
    for (let n = 0; n < 4000; n++) {
      const offers = pick(r, OFFERS)
      const common = {
        itemProfile: pick(r, PROFILES),
        name: pick(r, NAMES),
        bookDetails: { ...EMPTY_BOOK_DETAILS, isbn: pick(r, ISBNS) },
        options: pick(r, OPTIONS),
        allergenDeclaration: pick(r, DECLS),
        ...pick(r, PAGES),
      }
      const s: ItemIssueState = { ...common, formats: asFormats(offers), itemRules: {} }
      const ctx = pick(r, CTXS)
      const expected = plain(legacyItemIssues({ ...common, offers }, ctx))
      if (expected.length) nonEmpty++
      expect(plain(itemIssues(s, ctx)), JSON.stringify({ s, ctx: { ...ctx, optionCounts: [...ctx.optionCounts] } })).toStrictEqual(expected)
    }
    // The generator must actually exercise the rules.
    expect(nonEmpty).toBeGreaterThan(2000)
  })

  it('covers the one place where registry order differs from the editor order (ISBN before option list and page)', () => {
    const common = {
      itemProfile: 'book' as const,
      name: { it: '!!!' },
      bookDetails: { ...EMPTY_BOOK_DETAILS, isbn: '123' },
      options: [{ key: 'y', listId: 'GONE', min: 0, max: null }],
      allergenDeclaration: NOT_REVIEWED,
      hasPage: true,
      slug: {},
    }
    const s: ItemIssueState = { ...common, formats: emptyFormats(), itemRules: {} }
    const ctx = CTXS[0]
    expect(itemIssues(s, ctx).map((i) => i.id)).toEqual(['isbn', 'optionList', 'pageAddress'])
    expect(plain(itemIssues(s, ctx))).toStrictEqual(plain(legacyItemIssues({ ...common, offers: [] }, ctx)))
  })
})
