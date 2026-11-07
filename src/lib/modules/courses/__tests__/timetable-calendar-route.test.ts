import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shapeTimetable } from '../timetable'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from './timetable-fixtures'

const state = vi.hoisted(() => ({
  gate: { kind: 'public' } as { kind: string },
  page: { _id: 'page-1', sections: [{ _type: 'timetableSection', _key: 'sec-1', courseScope: 'all', showOnlineDetails: true }] } as unknown,
  enabled: ['courses'] as unknown,
  project: { projectId: 'p', segment: 'cyce', hostScoped: true } as unknown,
  timetable: null as unknown,
  timetableCalls: [] as unknown[],
}))

vi.mock('@/lib/access/request', async (orig) => ({
  ...(await orig<typeof import('@/lib/access/request')>()),
  isSupportedLocale: (l: string) => ['en', 'fr', 'it'].includes(l),
  resolveAccessRouteProject: () => state.project,
}))
vi.mock('@/lib/access/visitor-routes', () => ({ projectEnabledModuleIds: async () => state.enabled }))
vi.mock('@/lib/access/page-gate.server', () => ({ loadGatedPage: async () => ({ page: state.page, gate: state.gate }) }))
vi.mock('@/lib/tenancy/host-scope', () => ({ resolveScopeFromProjectSegment: () => ({ defaultLocale: 'en', projectId: 'p' }) }))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: () => ({ fetchForTenant: async () => ({ pageType: 'page', slug: 'horaires' }) }),
}))
vi.mock('@/lib/scheduling/timetable.server', () => ({
  timetableForSection: async (...args: unknown[]) => {
    state.timetableCalls.push(args)
    return state.timetable
  },
}))

import { handleTimetableCalendar, parseCalendarQuery } from '../timetable-calendar-route.server'

const data = (online = true) =>
  shapeTimetable({
    window: { from: '2026-12-01', to: '2026-12-31' }, locale: 'fr', defaultLocale: 'en', timeZone: 'Europe/Brussels',
    courses: COURSES, occurrences: OCCURRENCES, series: SERIES, closures: CLOSURES, people: PEOPLE, siteLocations: LOCATIONS, venues: [], rooms: ROOMS, includeOnlineDetails: online,
  })

const ask = (qs: Record<string, string>, headers: Record<string, string> = {}, locale = 'fr') => {
  const q = new URLSearchParams({ page: 'page-1', section: 'sec-1', occurrence: 'o4', date: '2026-12-14', ...qs })
  return handleTimetableCalendar(new Request(`https://cyce.info/fr/site-access/timetable-calendar?${q}`, { headers: { host: 'cyce.info', ...headers } }), { locale, tenant: 'cyce' })
}

beforeEach(() => {
  state.gate = { kind: 'public' }
  state.enabled = ['courses']
  state.project = { projectId: 'p', segment: 'cyce', hostScoped: true }
  state.timetable = data()
  state.timetableCalls = []
  state.page = { _id: 'page-1', sections: [{ _type: 'timetableSection', _key: 'sec-1', courseScope: 'all', showOnlineDetails: true }] }
})

describe('parseCalendarQuery', () => {
  const p = (s: string) => parseCalendarQuery(new URLSearchParams(s))
  it('needs page, section, occurrence and a real date', () => {
    expect(p('page=a&section=b&occurrence=c&date=2026-12-14')).toEqual({ pageId: 'a', sectionKey: 'b', occurrenceId: 'c', date: '2026-12-14', scope: 'occurrence' })
    expect(p('page=a&section=b&occurrence=c&date=2026-12-14&scope=series')?.scope).toBe('series')
    expect(p('page=a&section=b&occurrence=c')).toBeNull()
    expect(p('page=a&section=b&occurrence=c&date=2026-02-30')).toBeNull()
    expect(p('page=a&section=b&occurrence=c&date=2026-12-14&scope=all')).toBeNull()
    expect(p(`page=a&section=b&occurrence=${'x'.repeat(200)}&date=2026-12-14`)).toBeNull()
  })
})

describe('GET timetable-calendar', () => {
  it('answers the .ics with calendar headers, a file name and no-store', async () => {
    const r = await ask({})
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="iyengar-yoga-2026-12-14.ics"')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    const body = await r.text()
    expect(body).toContain('BEGIN:VCALENDAR\r\n')
    expect(body).toContain('UID:o4@cyce.info')
    expect(body).toContain('SUMMARY:Iyengar Yoga')
    expect(body).toContain('URL:https://cyce.info/fr/horaires')
  })

  it('never asks for online details and never writes them, even when the data carries them', async () => {
    const r = await ask({})
    const opts = (state.timetableCalls[0] as [string, { includeOnlineDetails: boolean; includeEvents: boolean; from: string; to: string }])[1]
    expect(opts.includeOnlineDetails).toBe(false)
    expect(opts.includeEvents).toBe(false)
    expect([opts.from, opts.to]).toEqual(['2026-12-14', '2026-12-14'])
    const body = await r.text()
    for (const secret of ['zoom.example', '123 456 789', 'SECRET-PASS']) expect(body).not.toContain(secret)
  })

  it('scope=series reads the look-ahead window and adds RRULE / EXDATE / VTIMEZONE', async () => {
    const r = await ask({ occurrence: 'o1', date: '2026-12-03', scope: 'series' })
    const opts = (state.timetableCalls[0] as [string, { from: string; to: string }])[1]
    expect(opts.to > opts.from).toBe(true)
    const body = (await r.text()).replace(/\r\n /g, '')
    expect(body).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH')
    expect(body).toContain('BEGIN:VTIMEZONE')
    expect(body).toContain('EXDATE;TZID=Europe/Brussels:20261210T180000,20261224T180000,20261231T180000')
  })

  it('a restricted page: denied visitor = 404, granted visitor = file; the page is re-gated each time', async () => {
    state.gate = { kind: 'denied' }
    expect((await ask({})).status).toBe(404)
    state.gate = { kind: 'granted' }
    const r = await ask({})
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuses what is not there: wrong page, wrong section, unknown or cancelled session, hidden course', async () => {
    expect((await ask({ page: 'other' })).status).toBe(404)
    expect((await ask({ section: 'nope' })).status).toBe(404)
    expect((await ask({ occurrence: 'zzz' })).status).toBe(404)
    expect((await ask({ occurrence: 'o3', date: '2026-12-10' })).status).toBe(404) // cancelled
    expect((await ask({ occurrence: 'o4', date: '2026-12-15' })).status).toBe(404) // wrong date
    const d = data()
    d.courses = {}
    state.timetable = d
    expect((await ask({})).status).toBe(404)
  })

  it('module off, unknown site, cross-site request, bad query, far-away date', async () => {
    state.enabled = []
    expect((await ask({})).status).toBe(404)
    state.enabled = ['courses']
    state.project = null
    expect((await ask({})).status).toBe(404)
    state.project = { projectId: 'p', segment: 'cyce', hostScoped: true }
    expect((await ask({}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await ask({ date: 'nope' })).status).toBe(400)
    expect((await ask({ date: '2035-01-01' })).status).toBe(400)
    expect((await ask({}, {}, 'xx')).status).toBe(404)
    expect(state.timetableCalls).toHaveLength(0)
  })

  it('an unexpected failure is a bare 503; an empty (fail-soft) timetable is a 404', async () => {
    state.timetable = null // the reader's result is unusable -> thrown inside the handler
    const r = await ask({})
    expect(r.status).toBe(503)
    expect(await r.text()).toBe('')
    state.timetable = { ...data(), occurrences: [], courses: {} }
    expect((await ask({})).status).toBe(404)
  })
})
