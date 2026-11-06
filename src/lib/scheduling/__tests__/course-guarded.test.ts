import { describe, expect, it, vi } from 'vitest'
import { endClassGuarded, guardCourseOwner, guardPlace, saveClassGuarded, saveEditionGuarded, updateOccurrenceGuarded, COURSE_GUARD_QUERY, LOCATION_KEYS_QUERY } from '../course-guarded.server'
import type { CourseScheduleStore, SaveClassInput } from '../course-store'
import { ScheduleError } from '../types'

const P = '11111111-1111-4111-8111-111111111111'
const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERSON = '77777777-7777-4777-8777-777777777777'
const VENUE = '88888888-8888-4888-8888-888888888888'

const clientReturning = (answers: Record<string, unknown>) => ({
  fetch: vi.fn(async (query: string) => {
    const hit = Object.entries(answers).find(([k]) => query.includes(k))
    if (hit && hit[1] instanceof Error) throw hit[1]
    return hit ? hit[1] : null
  }),
})

const input: SaveClassInput = {
  projectId: P, seriesId: null, ownerPublicId: COURSE, timeZone: 'Europe/Brussels', weekday: 1, startTime: '18:00', startsOn: '2026-12-07',
  place: { kind: 'location', key: 'brey' }, attendanceMode: 'inPerson', instructorPublicIds: [PERSON], expectedVersion: null,
}
const fakeStore = () => {
  const store = {
    saveSeries: vi.fn(async () => ({ seriesId: 's', version: 1 })),
    syncSeries: vi.fn(async () => ({ inserted: 3, updated: 0, removed: 0, truncated: false, modifiedOutsideRule: [] })),
    updateOccurrence: vi.fn(async () => 2),
    endSeries: vi.fn(async () => 5),
    saveEdition: vi.fn(async () => ({ id: 'e', version: 1 })),
  }
  return store as unknown as CourseScheduleStore & typeof store
}
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as ScheduleError | null)?.code

describe('ownership and place checks', () => {
  it('the course must be a course (draft or published) of the caller\'s project', async () => {
    const ok = clientReturning({ 'count(*[_type == "course"': 1 })
    await expect(guardCourseOwner('slug-a', COURSE, { client: ok })).resolves.toBeUndefined()
    expect(ok.fetch).toHaveBeenCalledWith(COURSE_GUARD_QUERY, { projectSlug: 'slug-a', id: COURSE }, { perspective: 'raw' })
    expect(COURSE_GUARD_QUERY).toContain('projectSlug == $projectSlug')
    expect(COURSE_GUARD_QUERY).not.toContain('drafts.**')
    expect(await code(guardCourseOwner('slug-a', COURSE, { client: clientReturning({ 'count(*[_type == "course"': 0 }) }))).toBe('invalid')
    expect(await code(guardCourseOwner('slug-a', 'not-a-uuid', { client: ok }))).toBe('invalid')
    expect(await code(guardCourseOwner('', COURSE, { client: ok }))).toBe('invalid')
    expect(await code(guardCourseOwner('slug-a', COURSE, { client: clientReturning({ 'count(*[_type == "course"': new Error('down') }) }))).toBe('unavailable')
  })

  it('a location key must be in the project\'s siteConfig; a venue must be the project\'s', async () => {
    const keys = clientReturning({ 'siteConfig': ['brey', 'l51'] })
    await expect(guardPlace('slug-a', { kind: 'location', key: 'l51' }, { client: keys })).resolves.toBeUndefined()
    expect(keys.fetch).toHaveBeenCalledWith(LOCATION_KEYS_QUERY, { projectSlug: 'slug-a' }, { perspective: 'raw' })
    expect(await code(guardPlace('slug-a', { kind: 'location', key: 'other' }, { client: keys }))).toBe('invalid')
    expect(await code(guardPlace('slug-a', { kind: 'location', key: 'brey' }, { client: clientReturning({}) }))).toBe('invalid')
    await expect(guardPlace('slug-a', { kind: 'venue', venuePublicId: VENUE }, { client: clientReturning({ eventVenue: 1 }) })).resolves.toBeUndefined()
    expect(await code(guardPlace('slug-a', { kind: 'venue', venuePublicId: VENUE }, { client: clientReturning({ eventVenue: 0 }) }))).toBe('invalid')
    expect(await code(guardPlace('slug-a', { kind: 'venue', venuePublicId: 'x' }, { client: keys }))).toBe('invalid')
    const none = clientReturning({})
    await expect(guardPlace('slug-a', null, { client: none })).resolves.toBeUndefined()
    expect(none.fetch).not.toHaveBeenCalled()
  })
})

describe('guarded writes: nothing reaches the store unless every check passes', () => {
  it('saveClassGuarded checks owner, place and people, then saves and regenerates', async () => {
    const store = fakeStore()
    const client = clientReturning({ 'count(*[_type == "course"': 1, siteConfig: ['brey'] })
    const assertPeople = vi.fn(async () => undefined)
    const out = await saveClassGuarded('slug-a', input, { store, client, assertPeople })
    expect(assertPeople).toHaveBeenCalledWith('slug-a', [PERSON])
    expect(store.saveSeries).toHaveBeenCalledWith(input)
    expect(store.syncSeries).toHaveBeenCalledWith(P, 's')
    expect(out).toMatchObject({ seriesId: 's', version: 1, sync: { inserted: 3 } })
  })

  it('refuses a foreign course, place or person before any write', async () => {
    const good = { 'count(*[_type == "course"': 1, siteConfig: ['brey'] }
    for (const [label, client, assertPeople] of [
      ['course', clientReturning({ ...good, 'count(*[_type == "course"': 0 }), async () => undefined],
      ['place', clientReturning({ ...good, siteConfig: ['elsewhere'] }), async () => undefined],
      ['person', clientReturning(good), async () => { throw new ScheduleError('invalid', 'x') }],
    ] as const) {
      const store = fakeStore()
      expect(await code(saveClassGuarded('slug-a', input, { store, client, assertPeople })), label).toBe('invalid')
      expect(store.saveSeries).not.toHaveBeenCalled()
      expect(store.syncSeries).not.toHaveBeenCalled()
    }
  })

  it('updateOccurrenceGuarded checks substitutes; endClassGuarded passes the grant\'s project', async () => {
    const store = fakeStore()
    const upd = { projectId: P, occurrenceId: 'o', expectedVersion: 1, instructorPublicIds: [PERSON] }
    const assertPeople = vi.fn(async () => undefined)
    expect(await updateOccurrenceGuarded('slug-a', upd, { store, assertPeople })).toBe(2)
    expect(assertPeople).toHaveBeenCalledWith('slug-a', [PERSON])
    const store2 = fakeStore()
    const bad = async () => { throw new ScheduleError('invalid', 'x') }
    expect(await code(updateOccurrenceGuarded('slug-a', upd, { store: store2, assertPeople: bad }))).toBe('invalid')
    expect(store2.updateOccurrence).not.toHaveBeenCalled()
    expect(await endClassGuarded(P, 's', 3, { store })).toBe(5)
    expect(store.endSeries).toHaveBeenCalledWith(P, 's', 3)
  })

  it('saveEditionGuarded checks a course-owned term, not a site-wide one', async () => {
    const store = fakeStore()
    const ed = { projectId: P, label: { en: 'x' }, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels' }
    const none = clientReturning({ 'count(*[_type == "course"': 0 })
    expect(await code(saveEditionGuarded('slug-a', { ...ed, ownerType: 'course', ownerPublicId: COURSE }, { store, client: none }))).toBe('invalid')
    expect(store.saveEdition).not.toHaveBeenCalled()
    await saveEditionGuarded('slug-a', ed, { store, client: none })
    expect(store.saveEdition).toHaveBeenCalledTimes(1)
  })
})
