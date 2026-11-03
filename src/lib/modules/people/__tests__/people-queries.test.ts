/**
 * ADR-043 D4 — the real website queries, run with groq-js against fixtures:
 * off and anonymised people never render; archived people still render where
 * content names them (post authors, event hosts) but leave team listings and
 * lose their page; group listings follow the site-wide order; profile pages
 * follow the Publicly Routable Content Pattern.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import * as Q from '@/lib/sanity/queries'
import * as PQ from '../queries'
import type { PersonPublic } from '../projection'
import type { Event, Post, TeamSection } from '@/lib/sanity/types'

const NOW = new Date('2026-11-03T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const P = 'acme'
const ref = (id: string) => ({ _type: 'reference', _ref: id, _key: id, _weak: true })
const slug = (s: string, loc = 'it') => ({ [loc]: { _type: 'slug', current: s } })
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const person = (id: string, n: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  _type: 'person',
  projectSlug: P,
  publicId: uuid(n),
  firstName: `First${n}`,
  lastName: `Last${n}`,
  jobTitle: { _type: 'localizedString', it: `Ruolo ${n}`, en: `Role ${n}` },
  groups: ['teachers'],
  visibility: 'listed',
  sortOrder: n * 10,
  ...extra,
})

const dataset: Record<string, unknown>[] = [
  { _id: 'project-acme', _type: 'project', projectSlug: P },
  { _id: 'media-1', _type: 'mediaAsset', projectSlug: P, image: { _type: 'image', asset: { _type: 'reference', _ref: 'image-abc-10x10-jpg' }, hotspot: { x: 0.3, y: 0.4, width: 1, height: 1 } }, altText: { it: 'Foto di Anna' } },
  { _id: 'media-foreign', _type: 'mediaAsset', projectSlug: 'other', image: { _type: 'image', asset: { _type: 'reference', _ref: 'image-zzz-10x10-jpg' } } },
  // Order on purpose: listing order must come from sortOrder, not from here.
  person('p-c', 3, { photo: { _type: 'reference', _ref: 'media-foreign' } }),
  person('p-a', 1, { photo: { _type: 'reference', _ref: 'media-1' }, visibility: 'page', slug: { ...slug('anna'), ...slug('anna-en', 'en') }, redirectFrom: { it: ['anna-vecchia'] }, contacts: [{ _key: 'e', _type: 'personContact', kind: 'email', value: 'anna@example.com', preferred: true }], legacyAnchors: ['anna-a'] }),
  person('p-b', 2),
  person('p-off', 4, { visibility: 'off' }),
  person('p-archived', 5, { archivedAt: PAST, visibility: 'page', slug: slug('ex') }),
  person('p-anon', 6, { anonymisedAt: PAST, firstName: '', lastName: '' }),
  person('drafts.p-draft', 7),
  { ...person('p-foreign', 8), projectSlug: 'other' },
  person('p-other-group', 9, { groups: ['dentists'] }),
  {
    _id: 'page-team', _type: 'page', projectSlug: P, slug: slug('team'), title: { it: 'Team' },
    sections: [
      { _type: 'teamSection', _key: 'picked', people: [ref('p-b'), ref('p-a'), ref('p-off'), ref('p-archived'), ref('p-anon'), ref('p-draft'), ref('p-foreign')], groupFilter: 'teachers' },
      { _type: 'teamSection', _key: 'group', groupFilter: 'teachers' },
      { _type: 'teamSection', _key: 'legacy', members: [{ _type: 'teamMemberObject', _key: 'm', name: 'Old Member' }] },
    ],
  },
  {
    _id: 'post-1', _type: 'post', projectSlug: P, slug: slug('articolo'), publishedAt: PAST, title: { it: 'Articolo' },
    authors: [ref('p-archived'), ref('p-a'), ref('p-off'), ref('p-anon')],
  },
  {
    _id: 'event-1', _type: 'event', projectSlug: P, slug: slug('corso'), title: { it: 'Corso' },
    hostPeople: [ref('p-b'), ref('p-archived'), ref('p-foreign')],
  },
]

async function run<T = unknown>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const base = { projectSlug: P, locale: 'it', defaultLocale: 'it', charsPerMinute: 1000 }
  const all = { ...base, ...params }
  const value = await evaluate(parse(query, { params: all }), { dataset, params: all, timestamp: NOW })
  return (await value.get()) as T
}
const ids = (list: PersonPublic[] | null | undefined) => (list ?? []).map((p) => p.firstName)

describe('team section (page-by-slug)', () => {
  it('hand-picked: editor order; off, archived, anonymised, draft-only and foreign people left out; group not computed', async () => {
    const page = await run<{ sections: TeamSection[] }>(Q.pageBySlugQuery, { slug: 'team' })
    const picked = page.sections[0]
    expect(ids(picked.people)).toEqual(['First2', 'First1'])
    expect(picked.peopleCount).toBe(7)
    expect(picked.groupPeople).toBeNull()
  })

  it('by group: the site-wide order, listed people only', async () => {
    const page = await run<{ sections: TeamSection[] }>(Q.pageBySlugQuery, { slug: 'team' })
    const group = page.sections[1]
    expect(group.groupFilter).toBe('teachers')
    expect(ids(group.groupPeople)).toEqual(['First1', 'First2', 'First3'])
  })

  it('a section without people keeps its inline members (fallback) and no people', async () => {
    const page = await run<{ sections: TeamSection[] }>(Q.pageBySlugQuery, { slug: 'team' })
    const legacy = page.sections[2]
    expect(legacy.members?.[0].name).toBe('Old Member')
    expect(legacy.people ?? []).toEqual([])
    expect(legacy.peopleCount ?? 0).toBe(0)
    expect(legacy.groupPeople).toBeNull()
  })

  it('photo: Media Library image with its focal point and alt text; another website’s asset never', async () => {
    const page = await run<{ sections: TeamSection[] }>(Q.pageBySlugQuery, { slug: 'team' })
    const anna = page.sections[0].people!.find((p) => p.firstName === 'First1')!
    expect(anna.photo?.asset).toEqual({ _type: 'reference', _ref: 'image-abc-10x10-jpg' })
    expect(anna.photo?.hotspot).toMatchObject({ x: 0.3, y: 0.4 })
    expect(anna.photo?.alt).toBe('Foto di Anna')
    const third = page.sections[1].groupPeople!.find((p) => p.firstName === 'First3')!
    expect(third.photo).toBeNull()
  })

  it('the legacy home page projects the same people fields', async () => {
    expect(Q.homePageQuery).toContain(PQ.TEAM_SECTION_PEOPLE_FIELDS)
    expect(Q.PAGE_SECTIONS_PROJECTION).toContain(PQ.TEAM_SECTION_PEOPLE_FIELDS)
  })
})

describe('post authors and event hosts', () => {
  it('post: authors in order, archived kept (named by content), off and anonymised dropped', async () => {
    const post = await run<Post>(Q.postBySlugQuery, { slug: 'articolo' })
    expect(ids(post.authors)).toEqual(['First5', 'First1'])
    expect(post.authors![0].archived).toBe(true)
    expect(post.authorCount).toBe(4)
  })

  it('event: hostPeople in order, archived kept, another website’s person dropped', async () => {
    const event = await run<Event>(Q.eventBySlugQuery, { slug: 'corso' })
    expect(ids(event.hostPeople)).toEqual(['First2', 'First5'])
    expect(event.hostPeopleCount).toBe(3)
  })

  it('every post query that has the old author also has authors', () => {
    for (const [name, q] of Object.entries(Q)) {
      if (typeof q !== 'string' || !q.includes('"author": author->')) continue
      expect(q, name).toContain(PQ.POST_AUTHORS_FIELDS)
    }
  })
})

describe('profile pages (Publicly Routable Content Pattern)', () => {
  it('primary lookup: own page, listed, not archived; no slug fallback', async () => {
    const anna = await run<PersonPublic & { slugMap: unknown }>(PQ.PERSON_BY_SLUG_QUERY, { slug: 'anna' })
    expect(anna.firstName).toBe('First1')
    expect(anna.hasPage).toBe(true)
    expect(anna.slugMap).toMatchObject({ it: { current: 'anna' }, en: { current: 'anna-en' } })
    expect(await run(PQ.PERSON_BY_SLUG_QUERY, { slug: 'anna-en' })).toBeNull()
    expect(await run(PQ.PERSON_BY_SLUG_QUERY, { slug: 'ex' })).toBeNull()
  })

  it('redirect lookup, archived-slug check and legacy anchors', async () => {
    expect(await run(PQ.PERSON_BY_OLD_SLUG_QUERY, { slug: 'anna-vecchia' })).toEqual({ currentSlug: 'anna' })
    expect(await run(PQ.PERSON_SLUG_ARCHIVED_QUERY, { slug: 'ex' })).toBe(true)
    expect(await run(PQ.PERSON_SLUG_ARCHIVED_QUERY, { slug: 'anna' })).toBe(false)
    expect(await run(PQ.PERSON_BY_LEGACY_ANCHOR_QUERY, { anchor: 'anna-a' })).toEqual({ currentSlug: 'anna' })
  })

  it('sitemap lists only people with a page', async () => {
    const rows = await run<Array<{ slugMap: unknown }>>(PQ.SITEMAP_PEOPLE_QUERY)
    expect(rows).toHaveLength(1)
  })

  it('hasPage is false for a listed person and for a page person without a slug in this language', async () => {
    const page = await run<{ sections: TeamSection[] }>(Q.pageBySlugQuery, { slug: 'team' })
    const people = page.sections[1].groupPeople!
    expect(people.find((p) => p.firstName === 'First2')!.hasPage).toBe(false)
    const de = await run<PersonPublic[]>(PQ.PEOPLE_LISTING_QUERY, { locale: 'de' })
    expect(de.find((p) => p.firstName === 'First1')!.hasPage).toBe(false)
  })
})

describe('stand-alone reads', () => {
  it('by publicId (schedule instructors): archived kept, off / anonymised / foreign not', async () => {
    const rows = await run<PersonPublic[]>(PQ.PEOPLE_BY_PUBLIC_IDS_QUERY, { publicIds: [uuid(1), uuid(4), uuid(5), uuid(6), uuid(8)] })
    expect(rows.map((r) => r.publicId).sort()).toEqual([uuid(1), uuid(5)])
  })

  it('by group and listing: site-wide order, listable only', async () => {
    expect(ids(await run<PersonPublic[]>(PQ.PEOPLE_BY_GROUP_QUERY, { group: 'teachers' }))).toEqual(['First1', 'First2', 'First3'])
    expect(ids(await run<PersonPublic[]>(PQ.PEOPLE_LISTING_QUERY))).toEqual(['First1', 'First2', 'First3', 'First9'])
  })
})
