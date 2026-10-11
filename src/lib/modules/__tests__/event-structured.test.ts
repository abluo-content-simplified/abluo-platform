import { describe, expect, it } from 'vitest'
import {
  buildEventSchema,
  eventIsIndexable,
  eventTimeZone,
  formatAddressLine,
  resolveEventPlace,
} from '@/lib/modules/events/structured'
import { isValidTimeZone, resolveTimeZone } from '@/lib/time/zones'
import { getEventMessages, EVENT_MESSAGES_FOR_TEST } from '@/lib/i18n/event-messages'
import type { Event, SiteLocation } from '@/lib/sanity/types'

// ADR-031 D3/D6/D7 — where, when and the schema.org Event an event page emits.

const LOCATIONS: SiteLocation[] = [
  {
    _key: 'a',
    key: 'cervia',
    name: 'Da Mario Cervia',
    address: { street: 'Via Roma 1', postalCode: '48015', city: 'Cervia', country: 'IT' },
    pin: { lat: 44.26, lng: 12.35 },
  },
]

function ev(overrides: Partial<Event> = {}): Event {
  return {
    _id: 'e1',
    title: 'Jazz Friday',
    slug: { current: 'jazz-friday' },
    status: 'upcoming',
    startDate: '2026-11-13T19:00:00Z',
    ...overrides,
  }
}

describe('resolveEventPlace', () => {
  it('resolves a site location by key', () => {
    const p = resolveEventPlace(ev({ place: { kind: 'location', locationKey: 'cervia' } }), LOCATIONS)
    expect(p?.source).toBe('location')
    expect(p?.name).toBe('Da Mario Cervia')
    expect(p?.pin).toEqual({ lat: 44.26, lng: 12.35 })
    expect(p?.mapsLink).toContain('44.26')
  })

  it('returns null for a key that no longer exists (page falls back to free text)', () => {
    expect(resolveEventPlace(ev({ place: { kind: 'location', locationKey: 'gone' } }), LOCATIONS)).toBeNull()
  })

  it('resolves a saved venue, keeping its own time zone', () => {
    const p = resolveEventPlace(
      ev({ place: { kind: 'venue', venue: { name: 'Royal Society', timeZone: 'Europe/London', address: { city: 'London' } } } }),
      LOCATIONS,
    )
    expect(p).toMatchObject({ source: 'venue', name: 'Royal Society', timeZone: 'Europe/London' })
  })

  it('a venue the query refused to dereference (other project) resolves to null', () => {
    expect(resolveEventPlace(ev({ place: { kind: 'venue', venue: null } }), LOCATIONS)).toBeNull()
  })

  it('an online-only event has no place', () => {
    expect(
      resolveEventPlace(ev({ attendanceMode: 'online', place: { kind: 'location', locationKey: 'cervia' } }), LOCATIONS),
    ).toBeNull()
  })

  it('no place authored → null', () => {
    expect(resolveEventPlace(ev(), LOCATIONS)).toBeNull()
  })
})

describe('time zones', () => {
  it('venue zone wins over the website zone', () => {
    expect(eventTimeZone({ source: 'venue', mapsLink: null, timeZone: 'Europe/London' }, { timeZone: 'Europe/Rome' })).toBe('Europe/London')
  })
  it('falls back to the website zone, then to undefined', () => {
    expect(eventTimeZone(null, { timeZone: 'Europe/Rome' })).toBe('Europe/Rome')
    expect(eventTimeZone(null, {})).toBeUndefined()
  })
  it('ignores an invalid zone', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(resolveTimeZone('Mars/Olympus', 'Europe/Rome')).toBe('Europe/Rome')
  })
})

describe('visibility', () => {
  it('absent and public/websiteOnly are indexable; unlisted is not', () => {
    expect(eventIsIndexable(ev())).toBe(true)
    expect(eventIsIndexable(ev({ visibility: 'public' }))).toBe(true)
    expect(eventIsIndexable(ev({ visibility: 'websiteOnly' }))).toBe(true)
    expect(eventIsIndexable(ev({ visibility: 'unlisted' }))).toBe(false)
  })
})

describe('formatAddressLine', () => {
  it('joins only the parts that exist', () => {
    expect(formatAddressLine({ street: 'Via Roma 1', postalCode: '48015', city: 'Cervia', country: 'IT' })).toBe('Via Roma 1, 48015 Cervia, IT')
    expect(formatAddressLine({ city: 'London' })).toBe('London')
    expect(formatAddressLine({})).toBeUndefined()
    expect(formatAddressLine(undefined)).toBeUndefined()
  })
})

describe('buildEventSchema', () => {
  const base = { locale: 'it', url: 'https://damario.it/it/events/jazz-friday', origin: 'https://damario.it' }

  it('emits a scheduled in-person event with a structured place', () => {
    const event = ev({ place: { kind: 'location', locationKey: 'cervia' } })
    const s = buildEventSchema({ ...base, event, place: resolveEventPlace(event, LOCATIONS) })!
    expect(s['@type']).toBe('Event')
    expect(s.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(s.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')
    expect(s.location).toMatchObject({
      '@type': 'Place',
      name: 'Da Mario Cervia',
      address: { '@type': 'PostalAddress', addressLocality: 'Cervia', addressCountry: 'IT' },
      geo: { latitude: 44.26, longitude: 12.35 },
    })
    expect(s.organizer).toEqual({ '@id': 'https://damario.it#organization' })
  })

  it('maps cancelled and postponed', () => {
    expect(buildEventSchema({ ...base, event: ev({ eventStatus: 'cancelled' }), place: null })!.eventStatus).toBe(
      'https://schema.org/EventCancelled',
    )
    expect(buildEventSchema({ ...base, event: ev({ eventStatus: 'postponed' }), place: null })!.eventStatus).toBe(
      'https://schema.org/EventPostponed',
    )
  })

  it('sold out stays scheduled but marks every offer SoldOut', () => {
    const s = buildEventSchema({
      ...base,
      event: ev({ eventStatus: 'soldOut', priceOptions: [{ amount: 30, currency: 'eur', label: 'Dinner' }] }),
      place: null,
    })!
    expect(s.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(s.offers).toEqual([
      expect.objectContaining({ price: 30, priceCurrency: 'EUR', availability: 'https://schema.org/SoldOut', name: 'Dinner' }),
    ])
  })

  it('an online event gets a VirtualLocation and the online attendance mode', () => {
    const s = buildEventSchema({ ...base, event: ev({ attendanceMode: 'online' }), place: null })!
    expect(s.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode')
    expect(s.location).toEqual({ '@type': 'VirtualLocation', url: base.url })
  })

  it('falls back to the free-text location as a Place name', () => {
    const s = buildEventSchema({ ...base, event: ev({ location: 'Piazza Garibaldi' }), place: null })!
    expect(s.location).toEqual({ '@type': 'Place', name: 'Piazza Garibaldi' })
  })

  it('asserts nothing that is not authored', () => {
    const s = buildEventSchema({ ...base, event: ev(), place: null })!
    expect(s).not.toHaveProperty('location')
    expect(s).not.toHaveProperty('offers')
    expect(s).not.toHaveProperty('image')
    expect(s).not.toHaveProperty('endDate')
  })

  it('emits nothing for an unlisted event, or one without a title or start', () => {
    expect(buildEventSchema({ ...base, event: ev({ visibility: 'unlisted' }), place: null })).toBeNull()
    expect(buildEventSchema({ ...base, event: ev({ title: undefined }), place: null })).toBeNull()
    expect(buildEventSchema({ ...base, event: ev({ startDate: '' }), place: null })).toBeNull()
  })
})

describe('event status messages', () => {
  it('every locale has the ADR-031 labels', () => {
    for (const [locale, m] of Object.entries(EVENT_MESSAGES_FOR_TEST)) {
      for (const key of ['statusCancelled', 'statusPostponed', 'statusSoldOut', 'online'] as const) {
        expect(m[key], `${locale}.${key}`).toBeTruthy()
      }
    }
    expect(getEventMessages('it').statusCancelled).toBe('Annullato')
  })
})
