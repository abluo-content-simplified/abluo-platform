import { describe, expect, it, vi } from 'vitest'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { buildSearchQuery, buildSubQuery, isSanitySearchDef, searchTermGroups, wordAlternatives, type SanitySearchDef } from '../sanity-search'
import { requestSnippet } from '../requests-search'
import { allSearchSources } from '../sources'
import { runSearch, type SearchAccess } from '../run'
import { buildSnippetQuery, cutSnippet, firstSnippet, needlesOf, rowTexts } from '../snippet'

const defs = allSearchSources().map((s) => s.def).filter(isSanitySearchDef) as SanitySearchDef[]
const def = (k: string) => defs.find((d) => d.kind === k)!
const ALL: SearchAccess = { isEnabled: () => true, can: () => true, hideContactRequests: false }

describe('accent-tolerant term alternatives', () => {
  it('typed word, plus the stem without its final vowel', () => {
    expect(wordAlternatives('perche')).toEqual(['perche*', 'perch*'])
    expect(wordAlternatives('caffe')).toEqual(['caffe*', 'caff*'])
    expect(wordAlternatives('citta')).toEqual(['citta*', 'citt*'])
  })
  it('adds the accent-folded form when the user typed accents', () => {
    expect(wordAlternatives('perché')).toEqual(['perché*', 'perche*', 'perch*'])
    expect(wordAlternatives('città')).toEqual(['città*', 'citta*', 'citt*'])
  })
  it('no stem for short words, consonant endings or non-letters', () => {
    expect(wordAlternatives('ca')).toEqual(['ca*'])
    expect(wordAlternatives('ape')).toEqual(['ape*']) // stem would be 2 letters
    expect(wordAlternatives('dent')).toEqual(['dent*'])
    expect(wordAlternatives('2024a')).toEqual(['2024a*'])
    for (const w of ['ca', 'sa', 'ape', 'uno', 'oro']) {
      for (const p of wordAlternatives(w)) expect(p.replace('*', '').length, w).toBeGreaterThanOrEqual(Math.min(w.length, 3))
    }
  })
  it('groups per word, capped at 4 words x 3 alternatives', () => {
    const g = searchTermGroups('perche caffe citta casa ancora')
    expect(g).toHaveLength(4)
    expect(g.every((x) => x.length <= 3)).toBe(true)
  })
  it('binds every alternative as its own param; user text never reaches the query string', () => {
    const q = 'perché"] || true //'
    const built = buildSearchQuery(defs, 'p', searchTermGroups(q))
    expect(built.params).toMatchObject({ projectSlug: 'p', t0: 'perché*', t0a: 'perche*', t0b: 'perch*' })
    expect(built.query).toContain('$t0 ')
    expect(built.query).toContain('$t0a')
    expect(built.query).toContain('$t0b')
    expect(built.query).not.toMatch(/perch|true \/\//)
    expect(Object.keys(built.params).length).toBeLessThanOrEqual(1 + 4 * 3)
  })
  it('AND across words, OR within a word (one filter clause per word)', () => {
    const sub = buildSubQuery(def('blog'), [2, 1])
    const filter = sub.slice(0, sub.indexOf('| score('))
    expect(filter).toMatch(/\$t0 \|\| \[title/)
    expect(filter).toContain('$t0a')
    expect(filter).toContain('$t1')
    expect(filter).not.toContain('$t1a')
    expect(filter).toMatch(/\) && \(\(/) // the two word clauses are AND-ed
  })
})

describe('category / tag labels', () => {
  it('blog matches term labels, scoped to the project, filter-only', () => {
    const sub = buildSubQuery(def('blog'), [2])
    expect(sub).toContain('count(*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "blog" && kind == "category"')
    expect(sub).toContain('key in ^.categories')
    expect(sub).toContain('label.it')
    const score = sub.slice(sub.indexOf('| score('), sub.indexOf('| order('))
    expect(score).not.toContain('taxonomyTerm')
    expect(sub).toContain('categories[] match $t0') // legacy key matching stays
  })
  it('events and catalogue (categories + tags + primary category) declare their vocabulary', () => {
    expect(buildSubQuery(def('events'), [1])).toContain('module == "events" && kind == "category"')
    const cat = buildSubQuery(def('catalogue'), [1])
    expect(cat).toContain('module == "catalogue" && kind == "tag"')
    expect(cat).toContain('key == ^.primaryCategory')
    expect(cat).toContain('key in ^.additionalCategories')
  })
  it('every taxonomyTerm sub-query is project-scoped', () => {
    for (const d of defs) {
      const q = buildSubQuery(d, [1])
      for (const m of q.matchAll(/\*\[_type == "taxonomyTerm"[^\]]*/g)) expect(m[0]).toContain('projectSlug == $projectSlug')
    }
  })
})

describe('snippet cutting', () => {
  const needles = (s: string) => needlesOf(searchTermGroups(s).flat())
  const long = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Il caffè del mattino è importante per iniziare la giornata con calma e serenità, ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
  it('finds an accented word typed without accents and returns the exact original substring', () => {
    const s = cutSnippet(long, needles('caffe'))!
    expect(s.match).toBe('caffè')
  })
  it('window of ~120 chars, whole words, ellipses on cut sides', () => {
    const s = cutSnippet(long, needles('caffe'))!
    expect(s.before.startsWith('…')).toBe(true)
    expect(s.after.endsWith('…')).toBe(true)
    expect((s.before + s.match + s.after).length).toBeLessThanOrEqual(124)
    expect(s.before.slice(1).startsWith(' ')).toBe(false)
    const rebuilt = (s.before + s.match + s.after).replace(/…/g, '')
    expect(long).toContain(rebuilt)
    // not cut mid-word: the text just outside the window is a space
    const i = long.indexOf(rebuilt)
    expect(long[i - 1]).toBe(' ')
    expect([' ', undefined, ','].includes(long[i + rebuilt.length]) || /[,.]/.test(long[i + rebuilt.length])).toBe(true)
  })
  it('no ellipsis when the whole text fits; whitespace collapsed', () => {
    const s = cutSnippet('Una  visita\n\na marzo', needles('marzo'))!
    expect(s).toEqual({ before: 'Una visita a ', match: 'marzo', after: '' })
  })
  it('matches at word starts only (prefix), multi-word picks the first hit', () => {
    expect(cutSnippet('contrassegno', needles('segno'))).toBeUndefined()
    const s = cutSnippet('Prima la visita, poi il caffè.', needles('caffe visita'))!
    expect(s.match).toBe('visita')
  })
  it('no match -> undefined', () => {
    expect(cutSnippet('niente da vedere', needles('xyz'))).toBeUndefined()
    expect(firstSnippet(['', 'abc'], needles('zzz'))).toBeUndefined()
  })
  it('first field with a match wins', () => {
    expect(firstSnippet(['nothing', 'hello world', 'world again'], needles('world'))!.before).toBe('hello ')
  })
  it('rowTexts orders locales: viewer, site default, others', () => {
    const blog = def('blog')
    const texts = rowTexts(blog, { s1: { en: 'EN', it: 'IT', de: 'DE' } }, 'de', 'it')
    expect(texts.slice(0, 3)).toEqual(['DE', 'IT', 'EN'])
  })
})

describe('snippet source query', () => {
  it('is project-scoped, binds ids as an array and projects only declared fields', () => {
    const b = buildSnippetQuery([{ def: def('blog'), ids: ['a', 'drafts.b'] }], 'cyce')!
    expect(b.params).toEqual({ projectSlug: 'cyce', ids_blog: ['a', 'drafts.b'] })
    expect(b.query).toContain('_id in $ids_blog && projectSlug == $projectSlug')
    expect(b.query).toContain('pt::text(body.it)')
    expect(b.query).not.toMatch(/a'|drafts\.b/)
  })
  it('null when there is nothing to fetch', () => {
    expect(buildSnippetQuery([{ def: def('blog'), ids: [] }], 'cyce')).toBeNull()
  })
})

describe('runSearch snippets', () => {
  const body = 'Parlando della città e di tutto quello che la rende speciale, il caffè del mattino resta il momento migliore.'
  const first = (title: string) => ({
    _site: 'it',
    blog: [{ _id: 'drafts.p1', _score: 3, title: { it: title }, excerpt: { it: 'x' } }],
  })
  it('a title that already shows the match needs no second request', async () => {
    const fetchSanity = vi.fn(async () => first('Il caffè perfetto'))
    const res = await runSearch({ projectSlug: 'p', q: 'caffe', locale: 'it', access: ALL }, { fetchSanity, loadRequests: async () => [] })
    expect(fetchSanity).toHaveBeenCalledTimes(1)
    expect(res.ok && res.groups[0].hits[0].snippet).toBeUndefined()
  })
  it('one second request for the shown ids (draft id), snippet from the body', async () => {
    const fetchSanity = vi.fn(async (query: string) =>
      query.includes('$ids_blog')
        ? { blog: [{ _id: 'drafts.p1', s0: { it: null }, s1: { it: 'x' }, s2: { it: body }, s3: { it: 'Titolo' } }] }
        : first('Titolo')
    )
    const res = await runSearch({ projectSlug: 'p', q: 'caffe', locale: 'it', access: ALL }, { fetchSanity, loadRequests: async () => [] })
    expect(fetchSanity).toHaveBeenCalledTimes(2)
    expect((fetchSanity.mock.calls[1] as unknown[])[1]).toMatchObject({ projectSlug: 'p', ids_blog: ['drafts.p1'] })
    expect(res.ok && res.groups[0].hits[0].snippet?.match).toBe('caffè')
  })
  it('a failing second request never fails the search', async () => {
    let n = 0
    const fetchSanity = vi.fn(async () => {
      if (n++) throw new Error('boom')
      return first('Titolo')
    })
    const res = await runSearch({ projectSlug: 'p', q: 'caffe', locale: 'it', access: ALL }, { fetchSanity, loadRequests: async () => [] })
    expect(res.ok && res.groups[0].hits).toHaveLength(1)
  })
})

describe('contact request snippets', () => {
  const sub = (o: Partial<DashboardSubmission>): DashboardSubmission => ({
    id: 'x', formId: 'contact', name: null, email: null, status: 'new', createdAt: '2026-11-01T10:00:00Z', data: {}, source: null,
    formVersion: null, locale: null, consentAt: null, ...o,
  })
  it('snippet from the message when name/email did not match', () => {
    const s = requestSnippet(sub({ name: 'Anna', email: 'a@x.it', data: { message: 'Vorrei una visita a marzo' } }), 'marzo')!
    expect(s.match).toBe('marzo')
  })
  it('none when the name or email already shows the match', () => {
    expect(requestSnippet(sub({ name: 'Anna Rossi', data: { message: 'rossi' } }), 'rossi')).toBeUndefined()
  })
})
