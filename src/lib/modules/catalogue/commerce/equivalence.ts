// ── Catalogue commerce — the C10-5 equivalence check (pure) ───────────────────
//
// Decided — Tom 2026-11-02, D-7: compare old and new PUBLIC, VISITOR-VISIBLE
// outcomes by item, context, channel and fixed instant; report price-window
// gap cases (class W) separately; never require two intentionally different
// internal resolvers to return identical internal objects.
//
//   OLD = the legacy model on the BEFORE document: offers.ts (resolveOffer,
//         isSoldOn) and a frozen copy of the pre-R1 website offer mapping.
//   NEW = the V2 model on the AFTER document: commerceOf → explainAvailability /
//         resolveOffering / publicCommerce, and the R1 website resolver.
// In R1 (no data step) AFTER = BEFORE read through the dual-read; for the D2
// rehearsal AFTER = the migrated document and config.
//
// Used by commerce-equivalence.test.ts (synthetic F-E fixtures) and by
// scripts/catalogue/verify-commerce-equivalence.mjs (exports / staging).

import { localToUtc } from '@/lib/lifecycle/time'
import { evaluate as legacyEvaluate, WEEKDAYS, type Weekday } from '../availability'
import type { CatalogueAvailabilityDTO, CatalogueItemDTO, CatalogueOfferDTO } from '../dto'
import { isSoldOn, resolveOffer, type Offer } from '../offers'
import { channelSetOfConfig as resolveChannelSet, formatPrice, resolveCatalogueConfig, resolveItem, text, type CatalogueResolveContext, type RawCatalogueItem } from '../resolve'
import { catalogueCollectionJsonLd, catalogueItemJsonLd } from '../structured'
import { availabilityInputsOf, explainAvailability } from './channel-availability'
import { asChannelKey, type OfferingContext } from './commerce-types'
import { commerceOf, legacyOfferRefusals, type LegacyRefusal } from './legacy-commerce'
import { resolveOffering } from './offering'

export type EquivalenceProject = {
  /** The project's `serviceChannels` config BEFORE (legacy) and AFTER (migrated; = before in R1). */
  channelsBefore: readonly unknown[] | null
  channelsAfter: readonly unknown[] | null
  currency: string
  timeZone: string
  locale: string
  defaultLocale: string
}

export type EquivalenceDiff = { id: string; check: string; context?: string; at?: string; old: unknown; new: unknown }
export type ClassWCase = { id: string; context: string; at: string; offerKeys: string[]; newOutcome: string }

export type EquivalenceReport = {
  counts: { published: number; drafts: number; versions: number; total: number }
  diffs: EquivalenceDiff[]
  classW: ClassWCase[]
  refusals: { id: string; refusal: LegacyRefusal }[]
  /** True when diffs and refusals are empty and versions are 0 or mapped explicitly. Class W must be accepted by Tom case by case. */
  pass: boolean
}

type Doc = RawCatalogueItem & { _id: string }

const MINUTE = 60_000
const GENERAL = ''

const channelKeysOf = (entries: readonly unknown[] | null) =>
  (entries ?? []).map((e) => (e && typeof e === 'object' ? (e as { value?: unknown }).value : null)).filter((v): v is string => typeof v === 'string' && v !== '')

/** The reference instants (C10-5): every 30 min across the week from 2026-11-02 00:00 local, window boundaries, and two DST instants. */
export function referenceInstants(docs: readonly Doc[], timeZone: string): Date[] {
  const start = new Date(localToUtc('2026-11-02T00:00', timeZone).utc).getTime()
  const out = new Set<number>()
  for (let i = 0; i < 336; i++) out.add(start + i * 30 * MINUTE)
  const pad = (n: number) => String(n).padStart(2, '0')
  for (const d of docs) {
    for (const o of d.offers ?? []) {
      for (const w of o?.availability ?? []) {
        const days = (w?.days?.length ? w.days : WEEKDAYS).filter((x): x is Weekday => (WEEKDAYS as readonly string[]).includes(x))
        for (const day of days) {
          const date = `2026-11-${pad(2 + WEEKDAYS.indexOf(day))}`
          for (const hhmm of [w?.from, w?.to]) {
            if (typeof hhmm !== 'string' || !/^\d\d:\d\d$/.test(hhmm)) continue
            const t = new Date(localToUtc(`${date}T${hhmm}`, timeZone).utc).getTime()
            out.add(t)
            out.add(t - MINUTE)
          }
        }
      }
    }
  }
  out.add(Date.parse('2027-03-28T01:30:00Z'))
  out.add(Date.parse('2026-10-25T00:30:00Z'))
  return [...out].sort((a, b) => a - b).map((t) => new Date(t))
}

// ── The frozen pre-R1 website mapping (the OLD side of E6) ────────────────────

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Byte-for-byte the resolveOffers of v1.0.x before Catalogue V2 R1 (kept as the oracle; never used to render). */
export function legacyOfferDtos(rows: RawCatalogueItem['offers'], ctx: CatalogueResolveContext): CatalogueOfferDTO[] {
  const currency = ctx.config.currency
  const labels = new Map(ctx.config.channels.map((c) => [c.value, c.label]))
  const out: CatalogueOfferDTO[] = []
  for (const r of rows ?? []) {
    if (!r || typeof r._key !== 'string' || !finite(r.price) || r.price < 0) continue
    const channel = nonEmpty(r.channel)
    const availability: CatalogueAvailabilityDTO[] = (r.availability ?? []).filter(Boolean).map((a) => ({
      days: (a.days ?? []).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)),
      from: nonEmpty(a.from),
      to: nonEmpty(a.to),
    }))
    const tz = ctx.config.timeZone
    let state: CatalogueOfferDTO['state'] = null
    if (tz) {
      try {
        state = legacyEvaluate(availability, ctx.now, tz)
      } catch {
        state = null
      }
    }
    out.push({
      key: r._key,
      channel,
      channelLabel: channel ? labels.get(channel) ?? null : null,
      price: r.price,
      effectiveCurrency: currency,
      formattedPrice: formatPrice(r.price, currency, ctx.locale),
      isFree: r.price === 0,
      priceNote: text(r.priceNote, ctx.locale, ctx.defaultLocale),
      availability,
      state,
    })
  }
  return out
}

function legacyOffers(doc: Doc): Offer[] {
  return (doc.offers ?? []).filter((o): o is NonNullable<typeof o> => !!o && typeof o._key === 'string' && finite(o.price) && o.price >= 0).map((o) => ({
    _key: o._key,
    channel: o.channel,
    price: o.price as number,
    availability: (o.availability ?? []).filter(Boolean).map((a) => ({ days: a.days ?? undefined, from: a.from, to: a.to })),
  }))
}

const asPublic = (d: Doc): Doc => ({ ...d, publishedAt: '2000-01-01T00:00:00.000Z', expiresAt: null, archivedAt: null, hasPage: true, visibility: d.visibility ?? 'public' })

// ── The comparison ────────────────────────────────────────────────────────────

export function compareCommerce(
  pairs: readonly { before: Doc; after: Doc }[],
  project: EquivalenceProject,
  opts: { now?: Date; acceptVersions?: boolean } = {},
): EquivalenceReport {
  const now = opts.now ?? new Date('2026-11-02T10:00:00.000Z')
  const diffs: EquivalenceDiff[] = []
  const classW: ClassWCase[] = []
  const refusals: { id: string; refusal: LegacyRefusal }[] = []
  const ids = pairs.map((p) => p.before._id)
  const counts = {
    published: ids.filter((i) => !i.startsWith('drafts.') && !i.startsWith('versions.')).length,
    drafts: ids.filter((i) => i.startsWith('drafts.')).length,
    versions: ids.filter((i) => i.startsWith('versions.')).length,
    total: ids.length,
  }
  const keysBefore = channelKeysOf(project.channelsBefore)
  const cfgOf = (channels: readonly unknown[] | null) =>
    resolveCatalogueConfig({ catalogue: { currency: project.currency, serviceChannels: (channels ?? []) as never }, timeZone: project.timeZone }, project.locale, project.defaultLocale)!
  const configBefore = cfgOf(project.channelsBefore)
  const configAfter = cfgOf(project.channelsAfter)
  const ctxBefore: CatalogueResolveContext = { locale: project.locale, defaultLocale: project.defaultLocale, config: configBefore, now }
  const ctxAfter: CatalogueResolveContext = { locale: project.locale, defaultLocale: project.defaultLocale, config: configAfter, now }
  // Channel sets as the website reads them (resolve.ts channelSetOfConfig is the same rule).
  const channelsAfter = resolveChannelSet(configAfter)
  const instants = referenceInstants(pairs.map((p) => p.before), project.timeZone)
  const contexts: { label: string; ctx: OfferingContext; legacy: string }[] = [
    ...keysBefore.map((k) => ({ label: k, ctx: { kind: 'channel' as const, channel: asChannelKey(k) }, legacy: k })),
    { label: 'general', ctx: { kind: 'general' as const }, legacy: GENERAL },
  ]

  for (const { before, after } of pairs) {
    const id = before._id
    for (const refusal of legacyOfferRefusals(before.offers, keysBefore)) refusals.push({ id, refusal })
    const offers = legacyOffers(before)
    const commerce = commerceOf(after, channelsAfter)
    const fmt = commerce.formats[0]
    const inputs = availabilityInputsOf(channelsAfter)
    const itemInput = { itemId: id, primaryCategory: null, itemRules: commerce.itemRules, formats: commerce.formats }

    for (const c of contexts) {
      const general = c.ctx.kind === 'general'
      for (const t of instants) {
        const iso = t.toISOString()
        const old = resolveOffer(offers, c.legacy, t, project.timeZone, { currency: project.currency })
        const soldOld = isSoldOn(offers, c.legacy)
        const x = explainAvailability(inputs, itemInput, fmt.key, c.ctx, t, project.timeZone)
        // E1 / E4 — obtainable on a channel (general has no legacy obtainability: presence is lifecycle-only, C10-2 item 3).
        if (!general && soldOld !== (x.state === 'available')) diffs.push({ id, check: 'E1', context: c.label, at: iso, old: soldOld, new: x.state })
        const neu = resolveOffering(inputs, itemInput, fmt.key, c.ctx, t, project.timeZone, { currency: project.currency })
        if (old.kind === 'offer') {
          const ok = neu.kind === 'available' && neu.price.kind === 'price' && neu.price.price.key === old.offer._key && neu.price.price.amount === old.offer.price
          if (!ok) diffs.push({ id, check: 'E2', context: c.label, at: iso, old: { key: old.offer._key, price: old.offer.price }, new: summarise(neu) })
        } else if (old.kind === 'ambiguous') {
          const ok = neu.kind === 'available' && neu.price.kind === 'ambiguous' && (neu.price.scope ?? null) === old.scope && sameSet(neu.price.priceKeys, old.offers.map((o) => o._key))
          if (!ok) diffs.push({ id, check: 'E3', context: c.label, at: iso, old: { scope: old.scope, keys: old.offers.map((o) => o._key) }, new: summarise(neu) })
        } else if (soldOld) {
          // E5 — class W: the old point-in-time resolver said "not sold" only because of a window gap.
          classW.push({ id, context: c.label, at: iso, offerKeys: offers.map((o) => o._key), newOutcome: summarise(neu) })
        } else if (!general && neu.kind !== 'unavailable') {
          diffs.push({ id, check: 'E4', context: c.label, at: iso, old: 'notSold', new: summarise(neu) })
        }
      }
    }

    // E6 — the website DTO offers (key, amount, formatted, note, channel label, windows, order) byte-for-byte.
    const oldDtos = legacyOfferDtos(before.offers, ctxBefore)
    const newItem = resolveItem(asPublic(after), ctxAfter)
    const newDtos = newItem?.offers ?? []
    if (JSON.stringify(oldDtos) !== JSON.stringify(newDtos)) diffs.push({ id, check: 'E6', old: oldDtos, new: newDtos })

    // E7 — JSON-LD (item page, a list collection and a menu collection) deep-equal.
    const oldItem = resolveItem(asPublic(before), ctxBefore)
    if (oldItem && newItem) {
      const legacyDto: CatalogueItemDTO = { ...stripV2(oldItem), offers: oldDtos, hasOffers: oldDtos.length > 0 }
      const ldOld = jsonLd(legacyDto)
      const ldNew = jsonLd(stripV2(newItem))
      if (ldOld !== ldNew) diffs.push({ id, check: 'E7', old: ldOld, new: ldNew })
    } else if (!!oldItem !== !!newItem) diffs.push({ id, check: 'E7', old: !!oldItem, new: !!newItem })

    // E8 — general (no channels): the full old offer list = displayPrices in general.
    if (keysBefore.length === 0) {
      const a = oldDtos.map((o) => [o.key, o.price])
      const b = commerce.formats.flatMap((f) => (newItem?.formats ?? []).find((g) => g.key === f.key)?.prices.map((p) => [p.key, p.price]) ?? [])
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ id, check: 'E8', old: a, new: b })
    }

    // E9 — dashboard sanity (internal): price count and amounts.
    const e9old = offers.map((o) => o.price)
    const e9new = commerce.formats.flatMap((f) => f.prices.map((p) => p.amount))
    if (JSON.stringify(e9old) !== JSON.stringify(e9new)) diffs.push({ id, check: 'E9', old: e9old, new: e9new })
  }

  const versionsOk = counts.versions === 0 || opts.acceptVersions === true
  return { counts, diffs, classW, refusals, pass: diffs.length === 0 && refusals.length === 0 && versionsOk }
}


const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

function summarise(o: ReturnType<typeof resolveOffering>): string {
  if (o.kind === 'unavailable') return 'unavailable'
  const p = o.price
  if (p.kind === 'price') return `available:${p.source.kind}:${p.price.key}:${p.price.amount}`
  if (p.kind === 'ambiguous') return `available:ambiguous:${p.scope ?? 'standard'}:${p.priceKeys.join(',')}`
  return `available:${p.kind}:${'reason' in p ? p.reason : ''}`
}

/** The DTO as the pre-R1 resolver produced it: without the additive V2 fields. */
function stripV2(item: CatalogueItemDTO): CatalogueItemDTO {
  const { formats, hasPrices, ...rest } = item
  void formats
  void hasPrices
  return rest
}

const JSONLD_CTX = { url: 'https://www.example.test/books/x', locale: 'en', itemUrl: () => 'https://www.example.test/books/x' }

function jsonLd(item: CatalogueItemDTO): string {
  const page = { ...item, page: { slug: 'x', slugs: { en: 'x' } }, body: null }
  const section = { key: 's', name: 'S', parentKey: null, depth: 0, recovered: false, items: [item], children: [] }
  const collection = (collectionType: 'menu' | 'list') => ({
    publicId: 'c',
    collectionType,
    name: 'C',
    description: null,
    visibility: 'public' as const,
    page: { slug: 'c', slugs: { en: 'c' } },
    currency: item.offers[0]?.effectiveCurrency ?? 'EUR',
    sections: [section],
    issues: [],
    hasOffers: item.offers.length > 0,
  })
  return JSON.stringify([catalogueItemJsonLd(page, JSONLD_CTX), catalogueCollectionJsonLd(collection('list'), JSONLD_CTX), catalogueCollectionJsonLd(collection('menu'), JSONLD_CTX)])
}
