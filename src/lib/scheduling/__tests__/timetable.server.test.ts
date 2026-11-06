import { describe, expect, it, vi } from 'vitest'
import { timetableForSection, type TimetableDeps } from '../timetable.server'
import { hydrateTimetableSection } from '@/lib/modules/courses/timetable-section.server'
import { parseTimetableQuery } from '@/lib/modules/courses/timetable-route.server'
import type { TimetableSection } from '@/lib/sanity/types'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOM, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: () => Promise.reject(new Error('no network in tests')) }) }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: () => Promise.reject(new Error('no db in tests')) }))

const PROJECT = '11111111-1111-4111-8111-111111111111'

function fakes(over: { rooms?: typeof ROOMS; failPeople?: boolean; failStore?: boolean } = {}) {
  const meetingRoomsById = vi.fn(async (_p: string, ids: string[]) => new Map(ROOMS.filter((r) => ids.includes(r.id)).map((r) => [r.id, r])))
  const occurrencesInWindow = vi.fn(async () => {
    if (over.failStore) throw new Error('db down')
    return OCCURRENCES
  })
  const deps: TimetableDeps = {
    resolveProject: async () => PROJECT,
    store: { occurrencesInWindow, listSeries: async () => SERIES, listClosures: async () => CLOSURES, meetingRoomsById },
    fetchForTenant: (async (query: string) => {
      if (query.includes('_type == "course"')) return COURSES
      if (query.includes('_type == "person"')) {
        if (over.failPeople) throw new Error('sanity down')
        return PEOPLE
      }
      if (query.includes('"siteConfig"')) return { timeZone: 'Europe/Brussels', locations: LOCATIONS }
      return []
    }) as TimetableDeps['fetchForTenant'],
  }
  return { deps, meetingRoomsById, occurrencesInWindow }
}

const opts = { from: '2026-12-01', to: '2026-12-31', locale: 'fr', defaultLocale: 'en' }

describe('timetableForSection', () => {
  it('returns the shaped timetable', async () => {
    const { deps } = fakes()
    const d = await timetableForSection('cyce', { ...opts, includeOnlineDetails: false }, deps)
    expect(d.timeZone).toBe('Europe/Brussels')
    expect(d.occurrences).toHaveLength(6)
    expect(Object.keys(d.courses).sort()).toHaveLength(2)
    expect(d.places.brey.name).toBe('BREY')
  })

  it('does not even READ the meeting rooms unless online details are allowed', async () => {
    const off = fakes()
    const a = await timetableForSection('cyce', { ...opts, includeOnlineDetails: false }, off.deps)
    expect(off.meetingRoomsById).not.toHaveBeenCalled()
    expect(a.rooms).toBeNull()
    expect(JSON.stringify(a)).not.toContain('SECRET-PASS')

    const on = fakes()
    const b = await timetableForSection('cyce', { ...opts, includeOnlineDetails: true }, on.deps)
    expect(on.meetingRoomsById).toHaveBeenCalledOnce()
    expect(on.meetingRoomsById.mock.calls[0][1]).toEqual([ROOM])
    expect(b.rooms![ROOM].passcode).toBe('SECRET-PASS')
  })

  it('reads only the picked courses; an empty pick shows nothing without touching scheduling', async () => {
    const { deps, occurrencesInWindow } = fakes()
    const none = await timetableForSection('cyce', { ...opts, coursePublicIds: [], includeOnlineDetails: false }, deps)
    expect(none.occurrences).toEqual([])
    expect(occurrencesInWindow).not.toHaveBeenCalled()
  })

  it('classes of a course that is not visible (draft, scheduled, archived) never reach the website', async () => {
    // The website query returns only visible courses; a draft course's classes exist in scheduling but its id is never asked for.
    const { deps, occurrencesInWindow } = fakes()
    const visibleOnly = { ...deps, fetchForTenant: (async () => [COURSES[0]]) as TimetableDeps['fetchForTenant'] }
    await timetableForSection('cyce', { ...opts, includeOnlineDetails: false }, visibleOnly)
    const asked = (occurrencesInWindow.mock.calls[0] as unknown as [string, { ownerPublicIds: string[] }])[1].ownerPublicIds
    expect(asked).toEqual([COURSES[0].publicId])
    // none visible → scheduling is not even read
    const none = fakes()
    const empty = await timetableForSection('cyce', { ...opts, includeOnlineDetails: false }, { ...none.deps, fetchForTenant: (async () => []) as TimetableDeps['fetchForTenant'] })
    expect(empty.occurrences).toEqual([])
    expect(none.occurrencesInWindow).not.toHaveBeenCalled()
  })

  it('the website course queries use COURSE_VISIBLE: published, not archived, go-live date passed (no date = visible)', async () => {
    const q = await import('@/lib/modules/courses/queries')
    for (const query of [q.COURSES_BY_PUBLIC_IDS_QUERY, q.COURSES_LISTING_QUERY]) {
      expect(query).toContain('!(_id in path("drafts.**"))')
      expect(query).toContain('!defined(archivedAt)')
      expect(query).toContain('(!defined(publishedAt) || publishedAt <= now())')
    }
  })

  it('fails soft: store down, unknown project, bad window → an empty timetable, never a throw', async () => {
    const down = await timetableForSection('cyce', { ...opts, includeOnlineDetails: true }, fakes({ failStore: true }).deps)
    expect(down).toMatchObject({ occurrences: [], series: [], rooms: null })
    const noProject = await timetableForSection('cyce', { ...opts, includeOnlineDetails: true }, { ...fakes().deps, resolveProject: async () => null })
    expect(noProject.occurrences).toEqual([])
    for (const [from, to] of [['nope', '2026-12-31'], ['2026-12-31', '2026-12-01'], ['2026-01-01', '2027-12-31']]) {
      const f = fakes()
      expect((await timetableForSection('cyce', { ...opts, from, to, includeOnlineDetails: false }, f.deps)).occurrences).toEqual([])
      expect(f.occurrencesInWindow).not.toHaveBeenCalled()
    }
  })

  it('a failing People or site read leaves names out but keeps the classes', async () => {
    const d = await timetableForSection('cyce', { ...opts, includeOnlineDetails: false }, fakes({ failPeople: true }).deps)
    expect(d.occurrences).toHaveLength(6)
    expect(d.teachers).toEqual({})
  })
})

describe('hydrateTimetableSection — the server-side online-details decision', () => {
  const section = (over: Partial<TimetableSection> = {}): TimetableSection => ({ _type: 'timetableSection', _key: 'k1', courseScope: 'all', showOnlineDetails: true, ...over })
  const ctx = (pageProtected: boolean, f = fakes()) => ({
    projectSlug: 'cyce',
    locale: 'fr',
    defaultLocale: 'en',
    fetchForTenant: f.deps.fetchForTenant!,
    pageId: 'page-1',
    pageProtected,
    now: new Date('2026-12-05T10:00:00Z'),
    deps: { store: f.deps.store, resolveProject: f.deps.resolveProject },
    f,
  })

  it('public page: the section asks for details but gets none', async () => {
    const c = ctx(false)
    const s = section()
    await hydrateTimetableSection(s, c)
    expect(s.timetable!.onlineDetails).toBe(false)
    expect(s.timetable!.data.rooms).toBeNull()
    expect(c.f.meetingRoomsById).not.toHaveBeenCalled()
    expect(JSON.stringify(s.timetable)).not.toContain('SECRET-PASS')
  })

  it('protected page, granted visitor, section asks: details are included', async () => {
    const c = ctx(true)
    const s = section()
    await hydrateTimetableSection(s, c)
    expect(s.timetable!.onlineDetails).toBe(true)
    expect(s.timetable!.data.rooms![ROOM].joinUrl).toBe('https://zoom.example/j/123')
  })

  it('protected page but the section does not ask: no details', async () => {
    const s = section({ showOnlineDetails: false })
    await hydrateTimetableSection(s, ctx(true))
    expect(s.timetable!.data.rooms).toBeNull()
  })

  it('hydrates the current month in the site zone (and the current week) and remembers the page', async () => {
    const s = section()
    await hydrateTimetableSection(s, ctx(false))
    expect(s.timetable).toMatchObject({ month: '2026-12', today: '2026-12-05', pageId: 'page-1' })
    expect(s.timetable!.data.window).toEqual({ from: '2026-11-30', to: '2026-12-31' })
  })

  it('picked courses are passed on; a missing project slug leaves the section unhydrated', async () => {
    const s = section({ courseScope: 'pick', courseIds: ['x', null] })
    const c = ctx(false)
    const inner = c.fetchForTenant
    const spy = vi.fn(((q: string, p?: Record<string, unknown>) => inner(q, p)) as typeof inner)
    await hydrateTimetableSection(s, { ...c, fetchForTenant: spy as typeof inner })
    const courseCall = spy.mock.calls.find(([q]) => (q as string).includes('publicIds'))
    expect(courseCall?.[1]).toMatchObject({ publicIds: ['x'] })
    const u = section()
    await hydrateTimetableSection(u, { ...ctx(false), projectSlug: undefined })
    expect(u.timetable).toBeUndefined()
  })
})

describe('parseTimetableQuery (the route never trusts more than page, section, month)', () => {
  const now = new Date('2026-12-05T10:00:00Z')
  const q = (s: string) => parseTimetableQuery(new URLSearchParams(s), now)
  it('accepts a page id, a section key and a month near today', () => {
    expect(q('page=p1&section=k1&month=2027-01')).toEqual({ pageId: 'p1', sectionKey: 'k1', month: '2027-01' })
  })
  it('rejects anything missing, malformed or far away', () => {
    for (const bad of ['section=k&month=2026-12', 'page=p&month=2026-12', 'page=p&section=k', 'page=p&section=k&month=2026-13', 'page=p&section=k&month=2026-1', 'page=p&section=k&month=2031-01', 'page=p&section=k&month=2020-01', `page=${'x'.repeat(200)}&section=k&month=2026-12`]) {
      expect(q(bad), bad).toBeNull()
    }
  })
  it('ignores any "online" or "rooms" parameter — there is no way to ask for details', () => {
    expect(q('page=p&section=k&month=2026-12&includeOnlineDetails=1&online=1')).toEqual({ pageId: 'p', sectionKey: 'k', month: '2026-12' })
  })
})
