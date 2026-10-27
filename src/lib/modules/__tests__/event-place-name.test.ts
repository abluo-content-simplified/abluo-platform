import { describe, expect, it } from 'vitest'
import { eventPlaceName, withEventPlaceName, withEventPlaceNames } from '@/lib/modules/events/structured'
import * as Q from '@/lib/sanity/queries'
import type { Event, SiteLocation } from '@/lib/sanity/types'

// ADR-031 — event cards and lists show the authored place (a site location or
// a saved venue) through the same resolver as the event page, and fall back to
// the free-text `location` when there is none.

// The real CYCE case: "Atelier avec Sabrina" picks the site location "brey".
const CYCE_LOCATIONS: SiteLocation[] = [
  { _key: 'k1', key: 'brey', name: 'Breydel (BREY)' },
  { _key: 'k2', key: 'berl', name: 'Berlaymont (BERL)' },
]

function ev(overrides: Partial<Event> = {}): Event {
  return { _id: 'e5d60a59-ce8f-4fc7-8c74-dc0ad88f5bce', title: 'Atelier avec Sabrina', slug: { current: 'atelier' }, status: 'upcoming', startDate: '2026-11-13T18:00:00Z', ...overrides }
}

describe('eventPlaceName', () => {
  it('a picked site location shows its (localized) name — the CYCE "brey" case', () => {
    expect(eventPlaceName(ev({ place: { kind: 'location', locationKey: 'brey' } }), CYCE_LOCATIONS)).toBe('Breydel (BREY)')
  })

  it("a saved venue shows the venue's name", () => {
    expect(eventPlaceName(ev({ place: { kind: 'venue', venue: { name: 'Salle Polyvalente' } } }), CYCE_LOCATIONS)).toBe('Salle Polyvalente')
  })

  it('falls back to the free-text location: no place, unknown key, missing venue, no site locations', () => {
    expect(eventPlaceName(ev({ location: 'Room 3' }), CYCE_LOCATIONS)).toBe('Room 3')
    expect(eventPlaceName(ev({ place: { kind: 'location', locationKey: 'gone' }, location: 'Room 3' }), CYCE_LOCATIONS)).toBe('Room 3')
    expect(eventPlaceName(ev({ place: { kind: 'venue', venue: null }, location: 'Room 3' }), CYCE_LOCATIONS)).toBe('Room 3')
    expect(eventPlaceName(ev({ place: { kind: 'location', locationKey: 'brey' }, location: 'Room 3' }), null)).toBe('Room 3')
    expect(eventPlaceName(ev(), CYCE_LOCATIONS)).toBeUndefined()
  })

  it('an online-only event shows what it showed before (its free-text location, if any)', () => {
    expect(eventPlaceName(ev({ attendanceMode: 'online', place: { kind: 'location', locationKey: 'brey' }, location: 'Teams' }), CYCE_LOCATIONS)).toBe('Teams')
    expect(eventPlaceName(ev({ attendanceMode: 'online', place: { kind: 'location', locationKey: 'brey' } }), CYCE_LOCATIONS)).toBeUndefined()
  })

  it('the place wins over an old free-text location', () => {
    expect(eventPlaceName(ev({ place: { kind: 'location', locationKey: 'brey' }, location: 'Old text' }), CYCE_LOCATIONS)).toBe('Breydel (BREY)')
  })
})

describe('withEventPlaceNames', () => {
  it('sets location on each card and leaves unchanged events as they are', () => {
    const picked = ev({ _id: 'a', place: { kind: 'location', locationKey: 'brey' } })
    const legacy = ev({ _id: 'b', location: 'Room 3' })
    const [a, b] = withEventPlaceNames([picked, legacy], CYCE_LOCATIONS)
    expect(a.location).toBe('Breydel (BREY)')
    expect(a.place).toEqual(picked.place)
    expect(b).toBe(legacy)
    expect(picked.location).toBeUndefined() // input not mutated
  })

  it('withEventPlaceName passes null through', () => {
    expect(withEventPlaceName(null as unknown as Event, CYCE_LOCATIONS)).toBeNull()
  })
})

describe('the card queries project the place', () => {
  const cardQueries = {
    eventsListingEventsNewestQuery: Q.eventsListingEventsNewestQuery,
    eventsListingEventsOldestQuery: Q.eventsListingEventsOldestQuery,
    eventsListingManualEventsQuery: Q.eventsListingManualEventsQuery,
    currentLiveEventQuery: Q.currentLiveEventQuery,
    homepageFeaturedEventQuery: Q.homepageFeaturedEventQuery,
    eventsQuery: Q.eventsQuery,
    pastEventsQuery: Q.pastEventsQuery,
    additionalLiveEventsQuery: Q.additionalLiveEventsQuery,
  }
  it.each(Object.entries(cardQueries))('%s', (_name, q) => {
    expect(q).toMatch(/"place": place \{\s*kind,\s*locationKey,/)
    expect(q).toContain('attendanceMode')
    // A venue resolves only within the same project.
    expect(q).toContain('venue->projectSlug == $projectSlug')
  })

  it('the site locations come from the same query as the event page', () => {
    expect(Q.eventSiteContextQuery).toMatch(/locations\[\]\s*\{[^}]*key,/)
  })
})
