import { describe, expect, it, vi } from 'vitest'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { NOT_SEARCHABLE } from '../not-searchable'
import { buildSearchQuery, buildSubQuery, isSanitySearchDef, mergeRows, searchTerms, type RawSearchRow, type SanitySearchDef } from '../sanity-search'
import { filterRequests } from '../requests-search'
import { allSearchSources } from '../sources'
import { normalizeQuery, permittedSources, runSearch, type SearchAccess, type SearchDeps } from '../run'

const sanityDefs = allSearchSources().map((s) => s.def).filter(isSanitySearchDef) as SanitySearchDef[]
const ALL: SearchAccess = { isEnabled: () => true, can: () => true, hideContactRequests: false }

describe('query builder', () => {
  const secret = 'rossi"] || true //'
  const built = buildSearchQuery(sanityDefs, 'proj-a', searchTerms(secret))

  it('every sub-query is project-scoped and excludes versions', () => {
    for (const d of sanityDefs) {
      const sub = buildSubQuery(d, 2)
      expect(sub).toContain('projectSlug == $projectSlug')
      expect(sub).toContain('!(_id in path("versions.**"))')
    }
    expect(built.query).toContain('_type == "siteConfig" && projectSlug == $projectSlug')
  })

  it('never puts user text in the query string; terms are bound params', () => {
    expect(built.query).not.toContain('rossi')
    expect(built.query).not.toContain('true //')
    expect(built.params.projectSlug).toBe('proj-a')
    expect(built.params.t0).toBe('rossi*')
    expect(built.query).toContain('$t0')
  })

  it('ranks title above body and expands per locale', () => {
    const blog = buildSubQuery(sanityDefs.find((d) => d.kind === 'blog')!, 1)
    expect(blog).toMatch(/boost\(\(\[title\.en/)
    expect(blog).toContain('pt::text(body.it)')
    expect(blog).toContain('categories[] match $t0')
  })

  it('includes only the kinds it is given (installed + permitted)', () => {
    const only = permittedSources(allSearchSources(), {
      isEnabled: (id) => id === 'blog',
      can: (p) => p === 'blog.post.read',
      hideContactRequests: false,
    })
    expect(only.map((s) => s.def.kind)).toEqual(['blog'])
    const q = buildSearchQuery(only.map((s) => s.def).filter(isSanitySearchDef) as SanitySearchDef[], 's', ['x*'])
    expect(q.kinds).toEqual(['blog'])
    expect(q.query).not.toContain('"event"')
  })

  it('media needs only the media permission, no module', () => {
    const only = permittedSources(allSearchSources(), { isEnabled: (id) => id === undefined, can: (p) => p === 'media.library.manage', hideContactRequests: false })
    expect(only.map((s) => s.def.kind)).toEqual(['media'])
  })

  it('tokenises, caps words and strips wildcards', () => {
    expect(searchTerms('  Foo  *bar" baz qux quux ')).toEqual(['foo*', 'bar*', 'baz*', 'qux*'])
  })
})

describe('merge', () => {
  const rows: RawSearchRow[] = [
    { _id: 'a', _score: 1, archivedAt: null, title: { en: 'Published' } },
    { _id: 'drafts.a', _score: 3, title: { en: 'Draft text' } },
    { _id: 'drafts.b', _score: 2, title: { en: 'Only draft' } },
    { _id: 'c', _score: 5, archivedAt: '2026-01-01' },
    { _id: 'drafts.c', _score: 4 },
  ]
  it('draft text wins, draft-only flagged, archived taken from the published row and hidden', () => {
    const m = mergeRows(rows, false)
    expect(m.map((x) => x.id)).toEqual(['a', 'b'])
    expect((m[0].row.title as { en: string }).en).toBe('Draft text')
    expect(m[0].draft).toBe(false)
    expect(m[1].draft).toBe(true)
  })
  it('includeArchived returns them marked archived', () => {
    const m = mergeRows(rows, true)
    expect(m.find((x) => x.id === 'c')!.archived).toBe(true)
    expect(m[0].id).toBe('c')
  })
})

const sub = (o: Partial<DashboardSubmission>): DashboardSubmission => ({
  id: 'x', formId: 'contact', name: null, email: null, status: 'new', createdAt: '2026-11-01T10:00:00Z', data: {}, source: null,
  formVersion: null, locale: null, consentAt: null, ...o,
})

describe('contact requests', () => {
  const rows = [
    sub({ id: '1', name: 'Anna Rossi', email: 'anna@x.it' }),
    sub({ id: '2', email: 'bob@x.it', data: { message: 'Vorrei una visita a marzo' } }),
    sub({ id: '3', name: 'Rossi Old', status: 'archived' }),
  ]
  it('matches name, email and any submission value; all words must match', () => {
    expect(filterRequests(rows, 'rossi', false).map((r) => r.id)).toEqual(['1'])
    expect(filterRequests(rows, 'marzo visita', false).map((r) => r.id)).toEqual(['2'])
    expect(filterRequests(rows, 'marzo anna', false)).toEqual([])
    expect(filterRequests(rows, 'rossi', true).map((r) => r.id)).toEqual(['1', '3'])
  })

  const deps = (loadRequests: SearchDeps['loadRequests']): SearchDeps => ({ fetchSanity: vi.fn(async () => ({})), loadRequests })
  it('returns a forms group for permitted viewers', async () => {
    const res = await runSearch({ projectSlug: 'p', q: 'rossi', locale: 'en', access: ALL }, deps(async () => rows))
    expect(res.ok && res.groups.map((g) => g.kind)).toEqual(['forms'])
    if (res.ok) {
      expect(res.groups[0].hits[0].href).toBe('/p/submissions?open=1')
      expect(res.groups[0].seeAllHref).toBe('/p/submissions?q=rossi')
    }
  })
  it('never loads requests without the permission or in a support visit without reveal', async () => {
    const load = vi.fn(async () => rows)
    await runSearch({ projectSlug: 'p', q: 'rossi', locale: 'en', access: { ...ALL, can: (p) => p !== 'forms.submission.read' } }, deps(load))
    await runSearch({ projectSlug: 'p', q: 'rossi', locale: 'en', access: { ...ALL, hideContactRequests: true } }, deps(load))
    expect(load).not.toHaveBeenCalled()
  })
})

describe('runSearch', () => {
  it('validates input', async () => {
    const deps: SearchDeps = { fetchSanity: vi.fn(), loadRequests: vi.fn() }
    expect(await runSearch({ projectSlug: 'p', q: ' a ', locale: 'en', access: ALL }, deps)).toEqual({ ok: false, q: ' a ', error: 'too_short' })
    expect(deps.fetchSanity).not.toHaveBeenCalled()
    const n = normalizeQuery('x'.repeat(500))
    expect('q' in n && n.q.length).toBe(100)
  })

  it('resolves titles by viewer locale then site default, orders groups, limits hits', async () => {
    const post = (i: number): RawSearchRow => ({ _id: `p${i}`, _score: 10 - i, title: { it: `Titolo ${i}` }, excerpt: { en: 'An excerpt' } })
    const fetchSanity = vi.fn(async () => ({
      _site: 'it',
      people: [{ _id: 'pe1', _score: 1, firstName: 'Maria', lastName: 'Bianchi', thumb: 'https://cdn/x.jpg' }],
      blog: [0, 1, 2, 3, 4, 5].map(post),
    }))
    const res = await runSearch({ projectSlug: 'p', q: 'tit', locale: 'de', access: ALL }, { fetchSanity, loadRequests: async () => [] })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.groups.map((g) => g.kind)).toEqual(['blog', 'people'])
    expect(res.groups[0].hits).toHaveLength(5)
    expect(res.groups[0].more).toBe(true)
    expect(res.groups[0].hits[0]).toMatchObject({ title: 'Titolo 0', subtitle: 'An excerpt', href: '/p/posts/write/p0' })
    expect(res.groups[0].seeAllHref).toBe('/p/posts?q=tit')
    expect(res.groups[1].hits[0]).toMatchObject({ title: 'Maria Bianchi', href: '/p/people/pe1' })
    expect(res.groups[1].hits[0].thumbUrl).toContain('https://cdn/x.jpg?w=96')
  })
})

describe('guard: every module with a createAction is searchable or explained', () => {
  it('declares search or is listed in NOT_SEARCHABLE (and not both)', () => {
    for (const m of MODULE_REGISTRY.filter((x) => x.createAction)) {
      const declared = Boolean(m.search)
      const listed = m.id in NOT_SEARCHABLE
      expect(declared || listed, `${m.id}: add a \`search\` block in registry.ts or an entry in NOT_SEARCHABLE`).toBe(true)
      expect(declared && listed, `${m.id}: declares search AND is in NOT_SEARCHABLE`).toBe(false)
    }
  })
  it('NOT_SEARCHABLE entries are real modules with a reason', () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id))
    for (const [id, reason] of Object.entries(NOT_SEARCHABLE)) {
      expect(ids.has(id), id).toBe(true)
      expect(reason.length).toBeGreaterThan(10)
    }
  })
  it('search declarations reference real read permissions', () => {
    for (const m of MODULE_REGISTRY.filter((x) => x.search)) {
      expect(m.platformContract.permissions.map((p) => p.id), m.id).toContain(m.search!.permission)
    }
  })
})

describe('draft rows whose published twin did not match', () => {
  it('reads published + archived state off the draft row (_pub)', () => {
    const rows: RawSearchRow[] = [
      { _id: 'drafts.a', _score: 3, _pub: { _id: 'a', archivedAt: null } },
      { _id: 'drafts.b', _score: 2, _pub: { _id: 'b', archivedAt: '2026-11-01T10:00:00Z' } },
      { _id: 'drafts.c', _score: 1, _pub: null },
    ]
    expect(mergeRows(rows, false).map((m) => [m.id, m.draft])).toEqual([['a', false], ['c', true]])
    expect(mergeRows(rows, true).find((m) => m.id === 'b')?.archived).toBe(true)
  })
  it('the sub-query projects the twin within the same project', () => {
    const def = allSearchSources().map((s) => s.def).filter(isSanitySearchDef)[0]
    expect(buildSubQuery(def, 1)).toContain('"_pub": select(_id in path("drafts.**") => *[projectSlug == $projectSlug')
  })
})
