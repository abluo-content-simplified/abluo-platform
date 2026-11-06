import { describe, expect, it, vi } from 'vitest'
import { timetableForSection, type TimetableDeps } from '../timetable.server'
import { eventsIncluded, hydrateTimetableSection } from '@/lib/modules/courses/timetable-section.server'
import { filterByLanguage, languagesIn, shapeTimetable } from '@/lib/modules/courses/timetable'
import { shapeTimetableEvents, type TimetableEventSource } from '@/lib/modules/courses/timetable-events'
import type { TimetableSection } from '@/lib/sanity/types'
import type { Occurrence } from '../types'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: () => Promise.reject(new Error('no network in tests')) }) }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: () => Promise.reject(new Error('no db in tests')) }))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const EV1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const EV2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'

const eventOcc = (id: string, eventPublicId: string, startLocal: string, over: Partial<Occurrence> = {}): Occurrence => ({
  id,
  seriesId: 's',
  eventPublicId,
  startLocal,
  endLocal: startLocal.slice(0, 11) + '12:00',
  timeZone: 'Europe/Brussels',
  startsAt: '2026-12-09T09:00:00.000Z',
  endsAt: null,
  status: 'scheduled',
  place: null,
  attendanceMode: 'inPerson',
  instructorPublicIds: [],
  note: null,
  version: 1,
  ...over,
})

const event = (publicId: string, title: string, over: Partial<TimetableEventSource> = {}): TimetableEventSource => ({
  _id: `id-${publicId}`,
  publicId,
  title,
  slug: { current: title.toLowerCase().replace(/ /g, '-') },
  eventStatus: 'scheduled',
  startDate: '2026-12-09T09:00:00Z',
  endDate: null,
  attendanceMode: 'inPerson',
  place: { kind: 'location', locationKey: 'brey' } as never,
  location: undefined,
  ...over,
})

describe('shapeTimetableEvents', () => {
  const window = { from: '2026-12-01', to: '2026-12-31' }
  const siteLocations = LOCATIONS as never

  it('uses the schedule sessions in the window, the event page slug and the place name', () => {
    const out = shapeTimetableEvents({ window, events: [event(EV1, 'Spring Workshop')], occurrences: [eventOcc('o1', EV1, '2026-12-09T10:00'), eventOcc('o2', EV1, '2027-02-01T10:00')], siteLocations })
    expect(out).toEqual([{ id: 'o1', eventId: EV1, title: 'Spring Workshop', slug: 'spring-workshop', date: '2026-12-09', start: '10:00', end: '12:00', placeName: 'BREY' }])
  })

  it('drops cancelled events and cancelled sessions; an event with only cancelled sessions does not fall back to its Sanity dates', () => {
    const out = shapeTimetableEvents({
      window,
      events: [event(EV1, 'Gone', { eventStatus: 'cancelled' }), event(EV2, 'Sessions cancelled')],
      occurrences: [eventOcc('o1', EV1, '2026-12-09T10:00'), eventOcc('o2', EV2, '2026-12-09T10:00', { status: 'cancelled' })],
      siteLocations,
    })
    expect(out).toEqual([])
  })

  it('an event with no schedule keeps its Sanity dates (in the site zone)', () => {
    const out = shapeTimetableEvents({ window, events: [event(EV1, 'Unscheduled', { startDate: '2026-12-12T08:30:00Z', endDate: '2026-12-12T10:00:00Z' })], occurrences: [], siteLocations, timeZone: 'Europe/Brussels' })
    expect(out).toMatchObject([{ date: '2026-12-12', start: '09:30', end: '11:00' }])
  })

  it('an event that owns a schedule but has no session in the window is not shown at its Sanity date', () => {
    const stale = event(EV1, 'Stale', { startDate: '2026-12-12T08:30:00Z' })
    expect(shapeTimetableEvents({ window, events: [stale], occurrences: [], siteLocations, timeZone: 'UTC', withSchedule: new Set([EV1]) })).toEqual([])
    expect(shapeTimetableEvents({ window, events: [stale], occurrences: [], siteLocations, timeZone: 'UTC', withSchedule: new Set() })).toHaveLength(1)
  })

  it('leaves out events outside the window', () => {
    expect(shapeTimetableEvents({ window, events: [event(EV1, 'Later', { startDate: '2027-03-01T09:00:00Z' })], occurrences: [], siteLocations, timeZone: 'UTC' })).toEqual([])
  })
})

describe('language helpers', () => {
  const data = shapeTimetable({ window: { from: '2026-12-01', to: '2026-12-31' }, locale: 'en', defaultLocale: 'en', courses: COURSES, occurrences: OCCURRENCES, series: SERIES, closures: [], people: PEOPLE, siteLocations: LOCATIONS, includeOnlineDetails: false })
  it('lists the languages present, sorted', () => {
    expect(languagesIn(data)).toEqual(['en', 'fr'])
  })
  it('narrows classes by language, keeps multi-language classes under each, and null means all', () => {
    const fr = filterByLanguage(data, 'fr')
    expect(fr.occurrences.every((o) => o.languages.includes('fr'))).toBe(true)
    expect(fr.series).toHaveLength(1)
    expect(filterByLanguage(data, null)).toBe(data)
  })
})

describe('events in the timetable reader', () => {
  const build = (over: { eventsFail?: boolean; hasSchedule?: boolean } = {}) => {
    const eventOcc = vi.fn(async () => [OCC_EV])
    const coursesStoreCalls = vi.fn()
    const deps: TimetableDeps = {
      resolveProject: async () => PROJECT,
      store: {
        occurrencesInWindow: async (...a: unknown[]) => (coursesStoreCalls(...a), OCCURRENCES),
        listSeries: async () => SERIES,
        listClosures: async () => CLOSURES,
        meetingRoomsById: async () => new Map(ROOMS.map((r) => [r.id, r])),
      },
      eventStore: { occurrencesInWindow: eventOcc as never },
      eventsWithSchedule: over.hasSchedule ? async () => new Set([EV1]) : async () => new Set<string>(),
      fetchForTenant: (async (query: string) => {
        if (query.includes('_type == "course"')) return COURSES
        if (query.includes('_type == "person"')) return PEOPLE
        if (query.includes('"siteConfig"')) return { timeZone: 'Europe/Brussels', locations: LOCATIONS }
        if (query.includes('_type == "event"')) {
          if (over.eventsFail) throw new Error('sanity down')
          return [event(EV1, 'Spring Workshop')]
        }
        return []
      }) as TimetableDeps['fetchForTenant'],
    }
    return { deps, eventOcc }
  }
  const OCC_EV = eventOcc('oe', EV1, '2026-12-09T10:00')
  const opts = { from: '2026-12-01', to: '2026-12-31', locale: 'en', defaultLocale: 'en', includeOnlineDetails: false }

  it('off by default: events are not even read', async () => {
    const { deps, eventOcc: spy } = build()
    const d = await timetableForSection('cyce', opts, deps)
    expect(d.events).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('on: one scheduling query for the window, events shaped into the data', async () => {
    const { deps, eventOcc: spy } = build()
    const d = await timetableForSection('cyce', { ...opts, includeEvents: true }, deps)
    expect(spy).toHaveBeenCalledOnce()
    expect(d.events).toMatchObject([{ title: 'Spring Workshop', date: '2026-12-09', slug: 'spring-workshop', placeName: 'BREY' }])
    expect(d.occurrences).toHaveLength(6) // classes unchanged
  })

  it('a Sanity-dated event is shown only if it has no schedule anywhere', async () => {
    const dated = (hasSchedule: boolean) => {
      const b = build({ hasSchedule })
      b.deps.eventStore = { occurrencesInWindow: (async () => []) as never }
      const inner = b.deps.fetchForTenant!
      b.deps.fetchForTenant = (async (q: string, p?: Record<string, unknown>) => (q.includes('_type == "event"') ? [event(EV1, 'Dated', { startDate: '2026-12-12T08:30:00Z' })] : inner(q, p))) as never
      return b.deps
    }
    expect((await timetableForSection('cyce', { ...opts, includeEvents: true }, dated(false))).events).toHaveLength(1)
    expect((await timetableForSection('cyce', { ...opts, includeEvents: true }, dated(true))).events).toEqual([])
  })

  it('a failing events read leaves the classes alone', async () => {
    const { deps } = build({ eventsFail: true })
    const d = await timetableForSection('cyce', { ...opts, includeEvents: true }, deps)
    expect(d.events).toEqual([])
    expect(d.occurrences).toHaveLength(6)
  })
})

describe('hydration: events module gate, members notes, site host', () => {
  const section = (over: Partial<TimetableSection> = {}): TimetableSection => ({
    _type: 'timetableSection',
    _key: 'k1',
    courseScope: 'all',
    includeEvents: true,
    notes: [{ _type: 'block', _key: 'n1', children: [{ _type: 'span', text: 'Hi' }] }] as never,
    membersNotes: [{ _type: 'block', _key: 'n2', children: [{ _type: 'span', text: 'Door code' }] }] as never,
    ...over,
  })

  it('eventsIncluded needs the setting AND the Events module on (unknown = off)', () => {
    expect(eventsIncluded({ includeEvents: true }, ['courses', 'events'])).toBe(true)
    expect(eventsIncluded({ includeEvents: true }, ['courses'])).toBe(false)
    expect(eventsIncluded({ includeEvents: true }, null)).toBe(false)
    expect(eventsIncluded({ includeEvents: false }, ['events'])).toBe(false)
    expect(eventsIncluded({}, ['events'])).toBe(false)
  })

  const base = (pageProtected: boolean, enabledModuleIds: string[] | null) => ({
    projectSlug: 'cyce',
    locale: 'en',
    defaultLocale: 'en',
    pageProtected,
    enabledModuleIds,
    now: new Date('2026-12-05T10:00:00Z'),
    fetchForTenant: (async (query: string) => {
      if (query.includes('_type == "course"')) return COURSES
      if (query.includes('"siteConfig"')) return { timeZone: 'Europe/Brussels', locations: LOCATIONS }
      if (query.includes('customDomain')) return 'WWW.CYCE.info'
      return []
    }) as TimetableDeps['fetchForTenant'] & ((q: string) => Promise<never>),
    deps: {
      resolveProject: async () => PROJECT,
      store: { occurrencesInWindow: async () => OCCURRENCES, listSeries: async () => SERIES, listClosures: async () => CLOSURES, meetingRoomsById: async () => new Map() },
      eventStore: { occurrencesInWindow: async () => [] },
    } as never,
  })

  it('members notes are removed on a public page (and when the project is unknown), kept for a granted visitor', async () => {
    const pub = section()
    await hydrateTimetableSection(pub, base(false, ['events']) as never)
    expect(pub.membersNotes).toBeNull()
    expect(JSON.stringify(pub)).not.toContain('Door code')
    expect(pub.notes).toBeTruthy()

    const unknown = section()
    await hydrateTimetableSection(unknown, { ...base(false, null), projectSlug: undefined } as never)
    expect(unknown.membersNotes).toBeNull()

    const granted = section()
    await hydrateTimetableSection(granted, base(true, ['events']) as never)
    expect(JSON.stringify(granted.membersNotes)).toContain('Door code')
  })

  it('the printed title host comes from the project domain, normalised', async () => {
    const s = section()
    await hydrateTimetableSection(s, base(false, ['events']) as never)
    expect(s.timetable!.siteHost).toBe('cyce.info')
  })
})
