import { describe, expect, it } from 'vitest'
import {
  archivedTarget,
  cleanProfileSegment,
  cleanProfileSegments,
  groupLabels,
  isPeopleModuleOn,
  namedPeople,
  personHref,
  planPeopleRoute,
  profileSegmentFor,
  resolvePersonRoute,
  teamSource,
  type PeopleFetch,
} from '../website'
import { loadPersonRoute } from '../route'
import { PERSON_BY_OLD_SLUG_QUERY, PERSON_BY_SLUG_QUERY } from '../queries'
import type { PersonPublic } from '../projection'

const person = (over: Partial<PersonPublic> = {}): PersonPublic => ({
  publicId: 'p1', firstName: 'Anna', lastName: 'Rossi', visibility: 'page', archived: false, hasPage: true, slug: { current: 'anna-rossi' }, ...over,
})

describe('profile segment', () => {
  it('accepts one lowercase url-safe segment', () => {
    expect(cleanProfileSegment('team')).toBe('team')
    expect(cleanProfileSegment(' /Insegnanti/ ')).toBe('insegnanti')
    expect(cleanProfileSegment('our-people')).toBe('our-people')
  })
  it('rejects nested, empty, invalid and platform-reserved words', () => {
    for (const bad of ['', 'a/b', 'Team Members', 'blog', 'events', 'news', 'catalogue', 'api', '_next', 'x'.repeat(65), 42, null]) {
      expect(cleanProfileSegment(bad), String(bad)).toBeNull()
    }
  })
  it('reads the localizedString per language, with no fallback between languages', () => {
    const cfg = [{ moduleId: 'people', config: { profileSegment: { _type: 'localizedString', en: 'team', it: 'insegnanti', de: 'blog' } } }]
    expect(cleanProfileSegments(cfg[0].config.profileSegment)).toEqual({ en: 'team', it: 'insegnanti' })
    expect(profileSegmentFor(cfg, 'it')).toBe('insegnanti')
    expect(profileSegmentFor(cfg, 'de')).toBeNull()
    expect(profileSegmentFor(cfg, 'fr')).toBeNull()
    expect(profileSegmentFor([], 'en')).toBeNull()
    expect(profileSegmentFor(null, 'en')).toBeNull()
  })
})

describe('module gating', () => {
  it('fails open when unresolved, gates when resolved', () => {
    expect(isPeopleModuleOn(null)).toBe(true)
    expect(isPeopleModuleOn(undefined)).toBe(true)
    expect(isPeopleModuleOn(['blog'])).toBe(false)
    expect(isPeopleModuleOn(['blog', 'people'])).toBe(true)
  })
})

describe('placement fallback (CONTRACTS 6.3)', () => {
  const a = person({ publicId: 'a' })
  const g = person({ publicId: 'g' })
  it('stored refs win, even when none is listable', () => {
    expect(teamSource({ peopleCount: 2, people: [a], groupFilter: 'x', groupPeople: [g] }, true)).toEqual({ kind: 'people', people: [a] })
    expect(teamSource({ peopleCount: 1, people: [], groupFilter: null }, true)).toEqual({ kind: 'people', people: [] })
  })
  it('else the group, else inline', () => {
    expect(teamSource({ peopleCount: 0, groupFilter: 'x', groupPeople: [g] }, true)).toEqual({ kind: 'people', people: [g] })
    expect(teamSource({ peopleCount: 0, groupFilter: 'x', groupPeople: null }, true)).toEqual({ kind: 'people', people: [] })
    expect(teamSource({ peopleCount: 0 }, true)).toEqual({ kind: 'inline' })
    expect(teamSource({}, true)).toEqual({ kind: 'inline' })
  })
  it('module not installed: always inline', () => {
    expect(teamSource({ peopleCount: 2, people: [a], groupFilter: 'x', groupPeople: [g] }, false)).toEqual({ kind: 'inline' })
  })
  it('named placements (authors, hosts): refs win, else legacy (null)', () => {
    const list = [a]
    expect(namedPeople(list, 1, true)).toBe(list)
    expect(namedPeople([], 2, true)).toEqual([])
    expect(namedPeople(null, 1, true)).toEqual([])
    expect(namedPeople(list, 0, true)).toBeNull()
    expect(namedPeople(list, undefined, true)).toBeNull()
    expect(namedPeople(list, 1, false)).toBeNull()
  })
})

describe('personHref', () => {
  const ctx = { siteBase: '/it/studio', segment: 'team' }
  it('needs a page, a slug in this language and a segment', () => {
    expect(personHref(person(), ctx)).toBe('/it/studio/team/anna-rossi')
    expect(personHref(person({ hasPage: false }), ctx)).toBeNull()
    expect(personHref(person({ slug: {} }), ctx)).toBeNull()
    expect(personHref(person(), { siteBase: '/it', segment: null })).toBeNull()
    expect(personHref(person(), null)).toBeNull()
  })
})

describe('planPeopleRoute', () => {
  it('matches exactly [segment, slug]', () => {
    expect(planPeopleRoute(['team', 'anna-rossi'], 'team')).toEqual({ slug: 'anna-rossi' })
    expect(planPeopleRoute(['Team', 'anna%20r'], 'team')).toEqual({ slug: 'anna r' })
  })
  it('falls through for everything else', () => {
    expect(planPeopleRoute(['team'], 'team')).toBeNull()
    expect(planPeopleRoute(['team', 'a', 'b'], 'team')).toBeNull()
    expect(planPeopleRoute(['servizi', 'anna'], 'team')).toBeNull()
    expect(planPeopleRoute(['team', 'anna'], null)).toBeNull()
  })
})

describe('resolvePersonRoute (requirements 2-3)', () => {
  const run = (t: { by?: unknown; old?: unknown; arch?: unknown }, calls: string[] = []) =>
    resolvePersonRoute(
      {
        bySlug: async () => (calls.push('by'), (t.by ?? null) as never),
        byOldSlug: async () => (calls.push('old'), (t.old ?? null) as never),
        archived: async () => (calls.push('arch'), (t.arch ?? null) as never),
      },
      'anna-rossi',
    )

  it('found: only the primary lookup runs', async () => {
    const calls: string[] = []
    expect(await run({ by: { publicId: 'p1' } }, calls)).toEqual({ kind: 'found', person: { publicId: 'p1' } })
    expect(calls).toEqual(['by'])
  })
  it('retired slug: redirect to the current one', async () => {
    expect(await run({ old: { currentSlug: 'anna-bianchi' } })).toEqual({ kind: 'redirect', slug: 'anna-bianchi' })
  })
  it('a redirect to itself is not followed (no loop)', async () => {
    expect(await run({ old: { currentSlug: 'anna-rossi' } })).toEqual({ kind: 'none' })
  })
  it('archived person', async () => {
    expect(await run({ arch: true })).toEqual({ kind: 'archived' })
  })
  it('nothing matches', async () => {
    expect(await run({})).toEqual({ kind: 'none' })
  })
})

describe('loadPersonRoute binds the three profile queries with the request locale and no slug fallback', () => {
  it('passes locale and slug through to each lookup', async () => {
    const seen: string[] = []
    const fetcher = (async (q: string, p: { slug: string; locale: string }) => {
      seen.push(`${q === PERSON_BY_SLUG_QUERY ? 'by' : q === PERSON_BY_OLD_SLUG_QUERY ? 'old' : 'arch'}:${p.slug}:${p.locale}`)
      return null
    }) as PeopleFetch
    expect(await loadPersonRoute(fetcher, { slug: 'x', locale: 'it', defaultLocale: 'en' })).toEqual({ kind: 'none' })
    expect(seen).toEqual(['by:x:it', 'old:x:it', 'arch:x:it'])
  })
})

describe('archivedTarget', () => {
  it('goes to the people page when the site has one, else the site root', () => {
    expect(archivedTarget({ siteBase: '/it/x', segment: 'team', pageAtSegmentExists: true })).toBe('/it/x/team')
    expect(archivedTarget({ siteBase: '/it/x', segment: 'team', pageAtSegmentExists: false })).toBe('/it/x')
    expect(archivedTarget({ siteBase: '', segment: 'team', pageAtSegmentExists: false })).toBe('/')
  })
})

describe('groupLabels', () => {
  const terms = [{ key: 'dentist', label: { _type: 'localizedString', en: 'Dentist', it: 'Odontoiatra' } }, { key: 'x', label: null }]
  it('localised, falls back to default then en, drops unknown keys', () => {
    expect(groupLabels(['dentist', 'x', 'nope'], terms, 'it', 'en')).toEqual(['Odontoiatra'])
    expect(groupLabels(['dentist'], terms, 'de', 'en')).toEqual(['Dentist'])
    expect(groupLabels(null, terms, 'it', 'en')).toEqual([])
  })
})
