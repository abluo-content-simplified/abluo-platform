/**
 * The catalogue sitemap / llms.txt / listing queries, EVALUATED (groq-js)
 * against a small dataset: hasPage false → nothing; unlisted → no sitemap, no
 * llms; archived/scheduled → nothing anywhere; module off → no rows.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import {
  SITEMAP_CATALOGUE_COLLECTIONS_QUERY,
  SITEMAP_CATALOGUE_ITEMS_QUERY,
  SITEMAP_CATALOGUE_LANDING_QUERY,
} from '../sitemap-queries'
import { LLMS_CATALOGUE_ITEMS_QUERY, LLMS_CATALOGUE_SEGMENT_QUERY } from '../llms'
import { catalogueCollectionByIdQuery } from '@/lib/sanity/queries'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'
const slug = (s: string) => ({ it: { _type: 'slug', current: s } })
const ref = (id: string) => ({ _type: 'reference', _ref: id, _key: id })

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  _id: id, _type: 'catalogueItem', projectSlug: 'rist', name: { it: id }, hasPage: true, slug: slug(id), ...extra,
})

const dataset: Record<string, unknown>[] = [
  { _id: 'p1', _type: 'project', projectSlug: 'rist', moduleInstallations: [{ _key: 'm', moduleId: 'catalogue', enabled: true, config: { publicSegment: 'menu' } }] },
  { _id: 'p2', _type: 'project', projectSlug: 'off', moduleInstallations: [{ _key: 'm', moduleId: 'catalogue', enabled: false, config: { publicSegment: 'menu' } }] },
  item('public'),
  item('website-only', { visibility: 'websiteOnly' }),
  item('unlisted', { visibility: 'unlisted' }),
  item('no-page', { hasPage: false }),
  item('archived', { archivedAt: PAST }),
  item('scheduled', { publishedAt: FUTURE }),
  { ...item('module-off'), projectSlug: 'off' },
  { _id: 'col', _type: 'catalogueCollection', projectSlug: 'rist', name: { it: 'Pranzo' }, hasPage: true, slug: slug('pranzo'), visibility: 'unlisted',
    sections: [{ _key: 's', name: { it: 'S' }, items: [ref('public'), ref('unlisted'), ref('archived')] }] },
  { _id: 'landing', _type: 'cataloguePage', projectSlug: 'rist' },
  { _id: 'landing-off', _type: 'cataloguePage', projectSlug: 'off' },
]

async function run<T = unknown>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = { projectSlug: 'rist', locale: 'it', defaultLocale: 'it', ...params }
  const value = await evaluate(parse(query, { params: p }), { dataset, params: p, timestamp: NOW })
  return (await value.get()) as T
}

const slugs = (rows: { slug?: { it?: { current?: string } }; slugs?: { it?: { current?: string } } }[]) =>
  rows.map((r) => (r.slug ?? r.slugs)?.it?.current).sort()

describe('catalogue delivery queries, evaluated', () => {
  it('sitemap items: public + websiteOnly only; no unlisted, no hasPage false, no hidden lifecycle, no module-off project', async () => {
    const rows = await run<{ projectSlug: string; segment: string; slug: { it: { current: string } } }[]>(SITEMAP_CATALOGUE_ITEMS_QUERY)
    expect(slugs(rows)).toEqual(['public', 'website-only'])
    expect(rows.every((r) => r.segment === 'menu')).toBe(true)
  })

  it('sitemap collections: an unlisted collection is not listed (C10)', async () => {
    expect(await run(SITEMAP_CATALOGUE_COLLECTIONS_QUERY)).toEqual([])
  })

  it('sitemap landing: only where the module is enabled', async () => {
    expect(await run(SITEMAP_CATALOGUE_LANDING_QUERY)).toEqual([{ projectSlug: 'rist', segment: 'menu' }])
  })

  it('llms items: structuredData context — no unlisted', async () => {
    expect(slugs(await run(LLMS_CATALOGUE_ITEMS_QUERY))).toEqual(['public', 'website-only'])
    expect(await run(LLMS_CATALOGUE_SEGMENT_QUERY)).toBe('menu')
    expect(await run(LLMS_CATALOGUE_SEGMENT_QUERY, { projectSlug: 'off' })).toBeNull()
  })

  it('listing section: the explicit pick shows unlisted items, never archived ones (C5)', async () => {
    const c = await run<{ sections: { items: { name: string }[] }[] }>(catalogueCollectionByIdQuery, { collectionId: 'col' })
    expect(c.sections[0].items.map((i) => i.name).sort()).toEqual(['public', 'unlisted'])
  })
})
