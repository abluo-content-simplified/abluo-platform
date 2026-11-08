import { describe, expect, it, vi } from 'vitest'
import { buildRelatedQuery, isSanitySearchDef, type RawSearchRow, type SanitySearchDef } from '../sanity-search'
import { allSearchSources } from '../sources'
import { runSearch, type RelatedLoader, type SearchAccess, type SearchDeps } from '../run'

const COURSES = allSearchSources().map((s) => s.def).filter(isSanitySearchDef).find((d) => d.kind === 'courses') as SanitySearchDef
const ALL: SearchAccess = { isEnabled: () => true, can: () => true, hideContactRequests: false }
const MARIA = '11111111-1111-4111-8111-111111111111'

const person = (id: string, publicId: string, first: string, last: string): RawSearchRow => ({ _id: id, _score: 3, publicId, firstName: first, lastName: last })
const course = (id: string, rel: string, title: string): RawSearchRow => ({ _id: id, _relId: rel, title: { en: title }, _updatedAt: '2026-11-01T10:00:00Z' })

/** Main response → people only; the second request (relatedIds) → courses. */
function setup(opts: { people?: RawSearchRow[]; direct?: RawSearchRow[]; related?: RawSearchRow[]; links?: Array<{ id: string; name: string }> }) {
  const fetchSanity = vi.fn(async (_q: string, params: Record<string, unknown>) =>
    'relatedIds' in params
      ? { courses: opts.related ?? [] }
      : { _site: 'en', people: opts.people ?? [], courses: opts.direct ?? [] }
  )
  const loader = vi.fn<RelatedLoader>(async () => opts.links ?? [])
  const deps: SearchDeps = { fetchSanity: fetchSanity as SearchDeps['fetchSanity'], loadRequests: async () => [], relatedLoaders: { courses: loader } }
  return { fetchSanity, loader, deps }
}

describe('courses also match through their teachers', () => {
  it('declares the relation on the courses block, not in the engine', () => {
    expect(COURSES.alsoMatchVia).toEqual({ via: 'people', reason: 'teacher', idField: 'publicId' })
  })

  it('lists the courses a matched teacher teaches, after direct matches, with a structured reason', async () => {
    const t = setup({
      people: [person('pe1', MARIA, 'Maria', 'Rossi')],
      direct: [course('c-direct', 'x', 'Maria Montessori workshop')],
      related: [course('c-yoga', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Yoga')],
      links: [{ id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', name: 'Maria Rossi' }],
    })
    const res = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, t.deps)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const g = res.groups.find((x) => x.kind === 'courses')!
    expect(g.hits.map((h) => h.id)).toEqual(['c-direct', 'c-yoga'])
    expect(g.hits[0].reason).toBeUndefined()
    expect(g.hits[1].reason).toEqual({ kind: 'teacher', name: 'Maria Rossi' })
    expect(g.hits[1].href).toBe('/p/courses/c-yoga')
    expect(t.loader).toHaveBeenCalledTimes(1)
    expect(t.loader.mock.calls[0][0]).toEqual([{ publicId: MARIA, name: 'Maria Rossi' }])
    // one main request + one related request (no snippet request needed: the direct title shows the match)
    expect(t.fetchSanity).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate a course that already matched directly', async () => {
    const t = setup({
      people: [person('pe1', MARIA, 'Maria', 'Rossi')],
      direct: [course('c-yoga', 'a', 'Maria yoga')],
      related: [course('c-yoga', 'a', 'Maria yoga'), course('drafts.c-yoga', 'a', 'Maria yoga')],
      links: [{ id: 'a', name: 'Maria Rossi' }],
    })
    const res = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, t.deps)
    if (!res.ok) throw new Error('failed')
    const hits = res.groups.find((x) => x.kind === 'courses')!.hits
    expect(hits).toHaveLength(1)
    expect(hits[0].reason).toBeUndefined()
  })

  it('does not call the loader when no person matched by name (bio-only match, or no people)', async () => {
    const bioOnly = setup({ people: [person('pe1', MARIA, 'Giulia', 'Bianchi')] })
    await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, bioOnly.deps)
    expect(bioOnly.loader).not.toHaveBeenCalled()
    const none = setup({})
    await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, none.deps)
    expect(none.loader).not.toHaveBeenCalled()
    expect(none.fetchSanity).toHaveBeenCalledTimes(1)
  })

  it('does not call the loader when courses are not permitted or People is not searched', async () => {
    for (const access of [
      { ...ALL, can: (p: string) => p !== 'courses.course.read' },
      { ...ALL, isEnabled: (id: string | undefined) => id !== 'courses' },
      { ...ALL, can: (p: string) => p !== 'people.person.read' },
      { ...ALL, isEnabled: (id: string | undefined) => id !== 'people' },
    ]) {
      const t = setup({ people: [person('pe1', MARIA, 'Maria', 'Rossi')], links: [{ id: 'a', name: 'Maria Rossi' }], related: [course('c1', 'a', 'Yoga')] })
      const res = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access }, t.deps)
      expect(t.loader).not.toHaveBeenCalled()
      if (res.ok) expect(res.groups.find((g) => g.kind === 'courses')?.hits.some((h) => h.reason) ?? false).toBe(false)
    }
  })

  it('a failing loader or related request never fails the search', async () => {
    const t = setup({ people: [person('pe1', MARIA, 'Maria', 'Rossi')] })
    t.loader.mockRejectedValueOnce(new Error('db down'))
    const res = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, t.deps)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.groups.map((g) => g.kind)).toEqual(['people'])
  })

  it('hides archived related courses unless asked', async () => {
    const archived = { ...course('c-old', 'a', 'Old'), archivedAt: '2026-01-01' }
    const mk = () => setup({ people: [person('pe1', MARIA, 'Maria', 'Rossi')], related: [archived], links: [{ id: 'a', name: 'Maria Rossi' }] })
    const hidden = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL }, mk().deps)
    expect(hidden.ok && hidden.groups.some((g) => g.kind === 'courses')).toBe(false)
    const shown = await runSearch({ projectSlug: 'p', q: 'maria', locale: 'en', access: ALL, includeArchived: true }, mk().deps)
    expect(shown.ok && shown.groups.find((g) => g.kind === 'courses')!.hits[0].archived).toBe(true)
  })
})

describe('related query', () => {
  it('is project-scoped, version-free and binds the ids', () => {
    const q = buildRelatedQuery(COURSES, 'publicId', ['a'], 'proj-a')!
    expect(q.query).toContain('projectSlug == $projectSlug')
    expect(q.query).toContain('!(_id in path("versions.**"))')
    expect(q.query).toContain('publicId in $relatedIds')
    expect(q.params).toEqual({ projectSlug: 'proj-a', relatedIds: ['a'] })
    expect(buildRelatedQuery(COURSES, 'publicId', [], 'p')).toBeNull()
    expect(() => buildRelatedQuery(COURSES, 'x"] || true', ['a'], 'p')).toThrow()
  })
})

describe('coursesTaughtBy', () => {
  it('reads the given project once and returns each course once with the teacher name', async () => {
    const { coursesTaughtBy } = await import('@/lib/api/course-schedule')
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const listSeries = vi.fn(async () => [
      { ownerPublicId: A, instructorPublicIds: [MARIA.toUpperCase()] },
      { ownerPublicId: A, instructorPublicIds: [MARIA] },
      { ownerPublicId: B, instructorPublicIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'] },
    ])
    const out = await coursesTaughtBy('proj-1', [{ publicId: MARIA, name: 'Maria Rossi' }, { publicId: 'not-a-uuid', name: 'X' }], { store: { listSeries } as never })
    expect(out).toEqual([{ id: A, name: 'Maria Rossi' }])
    expect(listSeries).toHaveBeenCalledTimes(1)
    expect(listSeries).toHaveBeenCalledWith('proj-1', { ownerType: 'course' })
    expect(await coursesTaughtBy('proj-1', [], { store: { listSeries } as never })).toEqual([])
    expect(listSeries).toHaveBeenCalledTimes(1)
  })
})
