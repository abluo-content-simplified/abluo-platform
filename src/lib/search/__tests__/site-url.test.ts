import { describe, expect, it, vi } from 'vitest'
import { allSearchSources } from '../sources'
import { buildSearchQuery, isSanitySearchDef, mergeRows, type RawSearchRow, type SanitySearchDef } from '../sanity-search'
import { runSearch, type SearchAccess } from '../run'
import { siteContext, siteUrlFor } from '../site-url'

const defs = allSearchSources().map((s) => s.def).filter(isSanitySearchDef) as SanitySearchDef[]
const def = (kind: string) => defs.find((d) => d.kind === kind)!
const ALL: SearchAccess = { isEnabled: () => true, can: () => true, hideContactRequests: false }
const slugs = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([l, c]) => [l, { current: c }]))

describe('query: updatedAt and public-page facts', () => {
  const q = buildSearchQuery(defs, 'p', ['x*']).query
  it('projects _updatedAt for every kind', () => {
    for (const d of defs) expect(q).toContain(`"${d.kind}": *[`)
    expect(q.match(/\{ _id, _updatedAt, archivedAt/g)).toHaveLength(defs.length)
  })
  it('reads _live and the slugs off the published document (row and draft twin) only for kinds with a public page', () => {
    const blog = q.slice(q.indexOf('"blog":'), q.indexOf('"events":'))
    expect(blog).toContain('"_live": (')
    expect(blog).toContain('"_slugs": slug')
    expect(blog.match(/"_live"/g)).toHaveLength(2)
    const media = q.slice(q.indexOf('"media":'), q.indexOf('"_site"'))
    expect(media).not.toContain('_live')
  })
  it('reads domain, languages and module-config segments in the same request', () => {
    expect(q).toContain('"_project": *[_type == "project" && projectSlug == $projectSlug')
    expect(q).toContain('customDomain')
    expect(q).toContain('"seg_catalogue": moduleInstallations[moduleId == "catalogue"')
    expect(q).toContain('config.courseSegment')
  })
  it('keeps score() free of the new fields', () => {
    expect(q).not.toMatch(/score\([^)]*_live/)
  })
})

describe('mergeRows: updatedAt and site facts', () => {
  const pub: RawSearchRow = { _id: 'a', _updatedAt: '2026-11-01T10:00:00Z', _live: true, _slugs: slugs({ it: 'ciao' }) }
  const draft: RawSearchRow = { _id: 'drafts.a', _updatedAt: '2026-11-05T10:00:00Z', _live: false, _slugs: slugs({ it: 'bozza' }) }
  it('shows the draft row time and the PUBLISHED slugs when both exist', () => {
    const [m] = mergeRows([pub, draft], false)
    expect(m.updatedAt).toBe('2026-11-05T10:00:00Z')
    expect(m.site).toEqual({ live: true, slugs: pub._slugs })
  })
  it('reads the published twin off the draft when the twin did not match', () => {
    const [m] = mergeRows([{ ...draft, _pub: { _id: 'a', _live: true, _slugs: slugs({ it: 'ciao' }) } }], false)
    expect(m.site).toEqual({ live: true, slugs: slugs({ it: 'ciao' }) })
  })
  it('a draft-only row has no site facts', () => {
    expect(mergeRows([{ ...draft, _pub: null }], false)[0].site).toBeUndefined()
  })
})

describe('siteUrlFor', () => {
  const facts = { customDomain: 'studiomartegani.com', locales: ['it', 'en', 'de'], seg_catalogue: 'menu', seg_courses: { it: 'corsi', en: 'classes' } }
  const ctx = siteContext(facts, 'it')
  const live = (s: Record<string, string>) => ({ live: true, slugs: slugs(s) })

  it('uses the canonical www origin and the viewer language when the site has it', () => {
    expect(siteUrlFor(def('blog'), live({ it: 'perche', en: 'why' }), ctx, 'en')).toBe('https://www.studiomartegani.com/en/blog/why')
    expect(siteUrlFor(def('events'), live({ it: 'serata' }), ctx, 'it')).toBe('https://www.studiomartegani.com/it/events/serata')
  })
  it('falls back to the site default when the viewer language is not a site language or has no slug', () => {
    expect(siteUrlFor(def('blog'), live({ it: 'perche', fr: 'pourquoi' }), ctx, 'fr')).toBe('https://www.studiomartegani.com/it/blog/perche')
    expect(siteUrlFor(def('blog'), live({ it: 'perche' }), ctx, 'en')).toBe('https://www.studiomartegani.com/it/blog/perche')
  })
  it('none when not live (draft-only, archived, expired, hidden)', () => {
    expect(siteUrlFor(def('blog'), { live: false, slugs: slugs({ it: 'x' }) }, ctx, 'it')).toBeUndefined()
  })
  it('none without a domain, or without any usable slug', () => {
    expect(siteUrlFor(def('blog'), live({ it: 'x' }), siteContext({ locales: ['it'] }, 'it'), 'it')).toBeUndefined()
    expect(siteUrlFor(def('blog'), live({ de: 'x' }), ctx, 'it')).toBeUndefined()
  })
  it('module-config segments: a plain string, or per language (no segment for a language = no page there)', () => {
    expect(siteUrlFor(def('catalogue'), live({ it: 'torta' }), ctx, 'it')).toBe('https://www.studiomartegani.com/it/menu/torta')
    expect(siteUrlFor(def('courses'), live({ it: 'yoga', en: 'yoga-en', de: 'yoga-de' }), ctx, 'en')).toBe('https://www.studiomartegani.com/en/classes/yoga-en')
    expect(siteUrlFor(def('courses'), live({ it: 'yoga', de: 'yoga-de' }), ctx, 'de')).toBe('https://www.studiomartegani.com/it/corsi/yoga')
    expect(siteUrlFor(def('courses'), live({ it: 'yoga' }), siteContext({ customDomain: 'a.it' }, 'it'), 'it')).toBeUndefined()
  })
  it('no route declared (media) = never a url', () => {
    expect(siteUrlFor(def('media'), live({ it: 'x' }), ctx, 'it')).toBeUndefined()
  })
})

describe('runSearch: updatedAt and siteUrl', () => {
  const run = (blog: RawSearchRow[], project: unknown = { customDomain: 'x.it', locales: ['it', 'en'] }) =>
    runSearch(
      { projectSlug: 'p', q: 'perche', locale: 'en', access: { ...ALL, isEnabled: (id) => id === 'blog' } },
      { fetchSanity: vi.fn(async () => ({ _site: 'it', _project: project, blog })), loadRequests: async () => [] }
    )
  const post = (id: string, extra: Record<string, unknown> = {}): RawSearchRow => ({ _id: id, _score: 1, _updatedAt: '2026-11-02T09:00:00Z', title: { it: 'Perché' }, ...extra })

  it('published → siteUrl in the viewer language; draft-only, archived and unpublished → none', async () => {
    const res = await run([
      post('live', { _live: true, _slugs: slugs({ it: 'perche', en: 'why' }) }),
      post('drafts.only', { _pub: null }),
      post('drafts.changed', { _updatedAt: '2026-11-07T09:00:00Z', _pub: { _id: 'changed', _live: true, _slugs: slugs({ it: 'cambiato' }) } }),
      post('hidden', { _live: false, _slugs: slugs({ it: 'nascosto' }) }),
    ])
    if (!res.ok) throw new Error('failed')
    const hits = Object.fromEntries(res.groups[0].hits.map((h) => [h.id, h]))
    expect(hits.live.siteUrl).toBe('https://www.x.it/en/blog/why')
    expect(hits.live.updatedAt).toBe('2026-11-02T09:00:00Z')
    expect(hits.only.siteUrl).toBeUndefined()
    expect(hits.only.draft).toBe(true)
    expect(hits.changed.siteUrl).toBe('https://www.x.it/it/blog/cambiato')
    expect(hits.changed.updatedAt).toBe('2026-11-07T09:00:00Z')
    expect(hits.hidden.siteUrl).toBeUndefined()
  })
  it('archived (shown on request) never gets a url', async () => {
    const res = await runSearch(
      { projectSlug: 'p', q: 'perche', locale: 'en', includeArchived: true, access: { ...ALL, isEnabled: (id) => id === 'blog' } },
      { fetchSanity: vi.fn(async () => ({ _site: 'it', _project: { customDomain: 'x.it' }, blog: [post('a', { archivedAt: '2026-10-01', _live: false, _slugs: slugs({ it: 'a' }) })] })), loadRequests: async () => [] }
    )
    if (!res.ok) throw new Error('failed')
    expect(res.groups[0].hits[0].archived).toBe(true)
    expect(res.groups[0].hits[0].siteUrl).toBeUndefined()
  })
  it('no domain → no siteUrl anywhere', async () => {
    const res = await run([post('live', { _live: true, _slugs: slugs({ it: 'perche' }) })], { locales: ['it'] })
    if (!res.ok) throw new Error('failed')
    expect(res.groups[0].hits[0].siteUrl).toBeUndefined()
  })
  it('contact requests: updatedAt is createdAt, no siteUrl', async () => {
    const res = await runSearch(
      { projectSlug: 'p', q: 'rossi', locale: 'en', access: ALL },
      { fetchSanity: vi.fn(async () => ({})), loadRequests: async () => [{ id: '1', formId: 'c', name: 'Rossi', email: 'r@x.it', status: 'new', createdAt: '2026-11-03T08:00:00Z', data: {} } as never] }
    )
    if (!res.ok) throw new Error('failed')
    expect(res.groups[0].hits[0]).toMatchObject({ updatedAt: '2026-11-03T08:00:00Z' })
    expect(res.groups[0].hits[0].siteUrl).toBeUndefined()
  })
})
