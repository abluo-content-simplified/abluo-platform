/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { evaluate, parse } from 'groq-js'
import {
  TESTIMONIAL_FIELDS,
  TESTIMONIAL_PUBLIC,
  TESTIMONIAL_PUBLIC_KEYS,
  normalizeTestimonial,
  type TestimonialRaw,
} from '../projection'
import {
  TESTIMONIALS_BY_IDS_QUERY,
  TESTIMONIALS_BY_TAG_QUERY,
  TESTIMONIALS_FEATURED_QUERY,
  TESTIMONIALS_LATEST_QUERY,
} from '../queries'
import { hydrateTestimonialsSection, orderPicked, testimonialLimitOf, testimonialSelectionOf, isTestimonialsModuleOn } from '../website'
import { DEFAULT_TESTIMONIAL_LIMIT, MAX_TESTIMONIAL_LIMIT } from '../model'
import type { TestimonialsSection } from '@/lib/sanity/types'
import { homePageQuery, pageBySlugQuery, pageHomeQuery } from '@/lib/sanity/queries'

// ADR-048 D1/D6 — the one public projection. The tests evaluate the REAL GROQ
// against a small dataset, so the filter is proven, not just read.

const QUERIES = {
  featured: TESTIMONIALS_FEATURED_QUERY,
  latest: TESTIMONIALS_LATEST_QUERY,
  tag: TESTIMONIALS_BY_TAG_QUERY,
  ids: TESTIMONIALS_BY_IDS_QUERY,
}

const base = { _type: 'testimonial', projectSlug: 'acme', permissionToPublish: true, _createdAt: '2026-01-01T00:00:00Z' }
const loc = (o: Record<string, string>, extra: Record<string, unknown> = {}) => ({ _type: 'localizedText', ...o, ...extra })
const dataset = [
  { ...base, _id: 'ok', publicId: 'p-ok', displayName: 'Anna', featured: true, tags: ['yoga'], body: loc({ it: 'Bellissimo', en: 'Lovely' }), originalLocale: 'it' },
  { ...base, _id: 'no-permission', publicId: 'p-np', permissionToPublish: false, displayName: 'No', body: loc({ en: 'x' }) },
  { ...base, _id: 'archived', publicId: 'p-ar', archivedAt: '2026-02-01T00:00:00Z', displayName: 'Arch', body: loc({ en: 'x' }) },
  { ...base, _id: 'expired', publicId: 'p-ex', expiresAt: '2020-01-01T00:00:00Z', displayName: 'Exp', body: loc({ en: 'x' }) },
  { ...base, _id: 'drafts.draft-only', publicId: 'p-dr', displayName: 'Draft', body: loc({ en: 'x' }) },
  { ...base, _id: 'other-tenant', publicId: 'p-ot', projectSlug: 'beta', displayName: 'Other', body: loc({ en: 'x' }) },
  {
    ...base,
    _id: 'anon',
    publicId: 'p-an',
    anonymous: true,
    displayName: 'Secret Name',
    body: loc({ en: 'Great' }),
    _createdAt: '2026-03-01T00:00:00Z',
  },
  {
    ...base,
    _id: 'machine',
    publicId: 'p-mc',
    displayName: 'Marie',
    originalLocale: 'fr',
    body: loc({ fr: 'Super', en: 'Super (en)' }, { translationStatus: { en: { _type: 'translationMeta', status: 'machine' } } }),
    tags: ['yoga', 'hatha'],
    _createdAt: '2026-04-01T00:00:00Z',
  },
]

async function run(query: string, params: Record<string, unknown> = {}) {
  const tree = parse(query, { params: { projectSlug: 'acme', locale: 'it', defaultLocale: 'it', limit: 10, ...params } })
  const value = await evaluate(tree, { dataset: dataset as never, params: { projectSlug: 'acme', locale: 'it', defaultLocale: 'it', limit: 10, ...params } })
  return (await value.get()) as any[]
}

describe('queries parse', () => {
  for (const [name, q] of Object.entries(QUERIES)) it(`${name} is valid GROQ`, () => expect(() => parse(q, { params: { projectSlug: 'a', locale: 'it', defaultLocale: 'it', limit: 1, tagKey: 'x', ids: [] } })).not.toThrow())
})

describe('public filter', () => {
  it('states every condition', () => {
    for (const part of ['projectSlug == $projectSlug', 'permissionToPublish == true', 'drafts.**', 'archivedAt']) expect(TESTIMONIAL_PUBLIC).toContain(part)
  })

  it('shows only published, unarchived, permitted testimonials of this project', async () => {
    const rows = await run(TESTIMONIALS_LATEST_QUERY)
    expect(rows.map((r) => r.publicId).sort()).toEqual(['p-an', 'p-mc', 'p-ok'])
  })

  it('never reaches another tenant, even when asked for its ids', async () => {
    const rows = await run(TESTIMONIALS_BY_IDS_QUERY, { ids: ['ok', 'other-tenant', 'no-permission', 'archived', 'drafts.draft-only'] })
    expect(rows.map((r) => r._id)).toEqual(['ok'])
  })

  it('featured / tag selections apply the same filter', async () => {
    expect((await run(TESTIMONIALS_FEATURED_QUERY)).map((r) => r.publicId)).toEqual(['p-ok'])
    expect((await run(TESTIMONIALS_BY_TAG_QUERY, { tagKey: 'yoga' })).map((r) => r.publicId).sort()).toEqual(['p-mc', 'p-ok'])
    expect(await run(TESTIMONIALS_BY_TAG_QUERY, { tagKey: 'nothing' })).toEqual([])
  })

  it('orders newest first and honours the limit', async () => {
    expect((await run(TESTIMONIALS_LATEST_QUERY)).map((r) => r.publicId)).toEqual(['p-mc', 'p-an', 'p-ok'])
    expect(await run(TESTIMONIALS_LATEST_QUERY, { limit: 1 })).toHaveLength(1)
  })
})

describe('projection shape', () => {
  it('returns text as { text, locale, machine } in the best language', async () => {
    const [ok] = (await run(TESTIMONIALS_FEATURED_QUERY, { locale: 'it' })) as any[]
    expect(ok.body).toEqual({ text: 'Bellissimo', locale: 'it', machine: false })
    // No text in the page language: the language it was written in comes before the site default.
    const [fromOriginal] = (await run(TESTIMONIALS_FEATURED_QUERY, { locale: 'de', defaultLocale: 'en' })) as any[]
    expect(fromOriginal.body).toMatchObject({ text: 'Bellissimo', locale: 'it' })
    // No original language stored: the site default, then English.
    const [fromDefault] = (await run(TESTIMONIALS_BY_IDS_QUERY, { ids: ['anon'], locale: 'de', defaultLocale: 'en' })) as any[]
    expect(fromDefault.body).toMatchObject({ text: 'Great', locale: 'en' })
  })

  it('flags machine text and falls back to the original language before the default', async () => {
    const rows = await run(TESTIMONIALS_BY_IDS_QUERY, { ids: ['machine'], locale: 'en', defaultLocale: 'it' })
    expect(rows[0].body).toEqual({ text: 'Super (en)', locale: 'en', machine: true })
    const fr = await run(TESTIMONIALS_BY_IDS_QUERY, { ids: ['machine'], locale: 'de', defaultLocale: 'it' })
    expect(fr[0].body).toMatchObject({ text: 'Super', locale: 'fr', machine: false })
  })

  it('does not project the name of an anonymous testimonial', async () => {
    const rows = await run(TESTIMONIALS_BY_IDS_QUERY, { ids: ['anon'] })
    expect(rows[0].displayName).toBeNull()
    expect(rows[0].anonymous).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('Secret Name')
  })

  it('projects only whitelisted keys — nothing private, nothing internal', async () => {
    const rows = await run(TESTIMONIALS_LATEST_QUERY)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...TESTIMONIAL_PUBLIC_KEYS].sort())
    for (const bad of ['fullName', 'email', 'phone', 'note', 'submission', 'permissionToPublish', 'translationStatus', 'projectSlug', '_id']) {
      expect(TESTIMONIAL_FIELDS, bad).not.toMatch(new RegExp(`\\b${bad}\\b`, 'i').source.replace('\\b_id\\b', '(?!)'))
    }
  })
})

describe('section fields reach the three page queries', () => {
  it.each([
    ['homePageQuery', homePageQuery],
    ['pageHomeQuery', pageHomeQuery],
    ['pageBySlugQuery', pageBySlugQuery],
  ])('%s', (_n, q) => {
    expect(q).toContain('selectionMode')
    expect(q).toContain('"testimonialIds": testimonials[]._ref')
    expect(q).toContain('showDisclosure')
  })
  it('none of them mentions translation status or private data', () => {
    for (const q of [homePageQuery, pageHomeQuery, pageBySlugQuery]) expect(q).not.toMatch(/testimonial_private|fullName/)
  })
})

const raw = (o: Partial<TestimonialRaw> = {}): TestimonialRaw => ({
  publicId: 'p1',
  displayName: 'Anna',
  anonymous: false,
  age: null,
  rating: 5,
  givenOn: '2026-01-02',
  source: 'website',
  sourceUrl: null,
  featured: false,
  tags: [],
  originalLocale: 'it',
  context: null,
  abstract: null,
  body: { text: 'Bellissimo', locale: 'it', machine: false },
  ...o,
})

describe('normalizeTestimonial — one coherent language per card (D6)', () => {
  it('uses the body language for the whole card', () => {
    const t = normalizeTestimonial(raw({ abstract: { text: 'Short', locale: 'it', machine: false }, context: { text: 'Socia', locale: 'it', machine: false } }), 'it')!
    expect(t).toMatchObject({ locale: 'it', abstract: 'Short', context: 'Socia', excerpt: 'Short', languageNote: null })
  })
  it('drops an abstract or context in another language rather than mixing', () => {
    const t = normalizeTestimonial(raw({ abstract: { text: 'Short', locale: 'en', machine: false }, context: { text: 'Member', locale: 'en', machine: false } }), 'it')!
    expect(t.abstract).toBeNull()
    expect(t.context).toBeNull()
    expect(t.excerpt).toBe('Bellissimo')
  })
  it('says "translated from" for machine text and "other language" when the page language has none', () => {
    expect(normalizeTestimonial(raw({ body: { text: 'Lovely', locale: 'en', machine: true } }), 'en')!.languageNote).toEqual({ kind: 'translated', from: 'it' })
    expect(normalizeTestimonial(raw(), 'de')!.languageNote).toEqual({ kind: 'other-language', language: 'it' })
  })
  it('returns null when there is nothing to show, and hides the name when anonymous', () => {
    expect(normalizeTestimonial(raw({ body: null }), 'it')).toBeNull()
    expect(normalizeTestimonial(raw({ body: { text: '  ', locale: 'it', machine: false } }), 'it')).toBeNull()
    expect(normalizeTestimonial(raw({ anonymous: true, displayName: null }), 'it')).toMatchObject({ anonymous: true, displayName: null })
  })
  it('ignores an out-of-range rating', () => {
    expect(normalizeTestimonial(raw({ rating: 9 }), 'it')!.rating).toBeNull()
  })
})

describe('hydrateTestimonialsSection', () => {
  const section = (o: Partial<TestimonialsSection> = {}): TestimonialsSection => ({ _type: 'testimonialsSection', _key: 'k', ...o }) as TestimonialsSection
  const fetcher = (rows: unknown[]) => {
    const calls: Array<{ q: string; p: Record<string, unknown> }> = []
    return { calls, fetchForTenant: (async (q: string, p: Record<string, unknown> = {}) => (calls.push({ q, p }), rows)) as never }
  }
  const ctx = (f: ReturnType<typeof fetcher>) => ({ locale: 'it', defaultLocale: 'it', fetchForTenant: f.fetchForTenant })

  it('featured (default) reads the featured query with the limit', async () => {
    const f = fetcher([raw()])
    const s = section()
    const items = await hydrateTestimonialsSection(s, ctx(f))
    expect(f.calls[0].q).toBe(TESTIMONIALS_FEATURED_QUERY)
    expect(f.calls[0].p).toMatchObject({ locale: 'it', defaultLocale: 'it', limit: DEFAULT_TESTIMONIAL_LIMIT })
    expect(items).toHaveLength(1)
    expect(s.testimonialItems).toBe(items)
  })
  it('latest / tag choose their query; tag without a key reads nothing', async () => {
    const a = fetcher([raw()])
    await hydrateTestimonialsSection(section({ selectionMode: 'latest', limit: 3 }), ctx(a))
    expect(a.calls[0]).toMatchObject({ q: TESTIMONIALS_LATEST_QUERY, p: { limit: 3 } })
    const b = fetcher([raw()])
    await hydrateTestimonialsSection(section({ selectionMode: 'tag', tagKey: 'yoga' }), ctx(b))
    expect(b.calls[0]).toMatchObject({ q: TESTIMONIALS_BY_TAG_QUERY, p: { tagKey: 'yoga' } })
    const c = fetcher([raw()])
    expect(await hydrateTestimonialsSection(section({ selectionMode: 'tag' }), ctx(c))).toEqual([])
    expect(c.calls).toEqual([])
  })
  it('selected keeps the editor order and drops ids that are no longer public', async () => {
    const f = fetcher([{ ...raw({ publicId: 'b' }), _id: 'B' }, { ...raw({ publicId: 'a' }), _id: 'A' }])
    const items = await hydrateTestimonialsSection(section({ selectionMode: 'selected', testimonialIds: ['A', 'gone', 'B', 'A'] }), ctx(f))
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(f.calls[0].p.ids).toEqual(['A', 'gone', 'B'])
  })
  it('selected with nothing picked reads nothing', async () => {
    const f = fetcher([])
    expect(await hydrateTestimonialsSection(section({ selectionMode: 'selected' }), ctx(f))).toEqual([])
    expect(f.calls).toEqual([])
  })
  it('skips rows with no text', async () => {
    const f = fetcher([raw({ body: null }), raw({ publicId: 'q' })])
    expect((await hydrateTestimonialsSection(section(), ctx(f))).map((i) => i.id)).toEqual(['q'])
  })

  it('helpers: limits, selection fallback, picked order, gating', () => {
    expect(testimonialLimitOf({})).toBe(DEFAULT_TESTIMONIAL_LIMIT)
    expect(testimonialLimitOf({ limit: 999 })).toBe(MAX_TESTIMONIAL_LIMIT)
    expect(testimonialLimitOf({ limit: 0 })).toBe(DEFAULT_TESTIMONIAL_LIMIT)
    expect(testimonialSelectionOf({ selectionMode: 'weird' as never })).toBe('featured')
    expect(orderPicked([{ _id: 'b' }, { _id: 'a' }], ['a', 'b', 'c'])).toEqual([{ _id: 'a' }, { _id: 'b' }])
    expect(isTestimonialsModuleOn(null)).toBe(true)
    expect(isTestimonialsModuleOn(['blog'])).toBe(false)
    expect(isTestimonialsModuleOn(['testimonials'])).toBe(true)
  })
})
