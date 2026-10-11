// ── Events module — where, when and structured data (ADR-031 D3/D6/D7) ────────
//
// Pure functions (no React, no Next.js) shared by the event page today and the
// partner API contract (`Event v1`) later, so the website and connected apps
// describe an event the same way.

import { getLocationMapsLink } from '@/lib/maps/locations'
import { resolveTimeZone } from '@/lib/time/zones'
import { DEFAULT_CURRENCY, validPriceOptions } from './engagement'
import type {
  BusinessLocation,
  Event,
  EventAttendanceMode,
  EventLifecycleStatus,
  EventVisibility,
  SiteLocation,
} from '@/lib/sanity/types'

/** What an event page knows about the website (eventSiteContextQuery). */
export interface EventSiteContext {
  timeZone?: string | null
  siteName?: string | null
  locations?: SiteLocation[] | null
}

/** Where an event happens, resolved from its authored place. */
export interface ResolvedEventPlace {
  /** `location` = one of the website's own locations; `venue` = a saved venue. */
  source: 'location' | 'venue'
  name?: string
  address?: BusinessLocation
  /** "Open in Google Maps" link, when the place carries anything a map can use. */
  mapsLink: string | null
  pin?: { lat: number; lng: number }
  /** Venue-specific zone, when it differs from the website. */
  timeZone?: string
}

export function eventVisibility(event: Pick<Event, 'visibility'> | null | undefined): EventVisibility {
  return event?.visibility ?? 'public'
}

export function eventLifecycleStatus(event: Pick<Event, 'eventStatus'> | null | undefined): EventLifecycleStatus {
  return event?.eventStatus ?? 'scheduled'
}

export function eventAttendanceMode(event: Pick<Event, 'attendanceMode'> | null | undefined): EventAttendanceMode {
  return event?.attendanceMode ?? 'inPerson'
}

/** Unlisted events are reachable by link only — never indexed. */
export function eventIsIndexable(event: Pick<Event, 'visibility'> | null | undefined): boolean {
  return eventVisibility(event) !== 'unlisted'
}

function validPin(pin: { lat?: number; lng?: number } | undefined): { lat: number; lng: number } | undefined {
  if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number') return undefined
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return undefined
  return { lat: pin.lat, lng: pin.lng }
}

/**
 * The event's place: a picked site location (by key) or a saved venue. An
 * online-only event has no place. A key that no longer exists, or a venue that
 * is missing, resolves to null — the page then falls back to the free-text
 * `location` exactly as before ADR-031.
 */
export function resolveEventPlace(
  event: Pick<Event, 'place' | 'attendanceMode'>,
  siteLocations: SiteLocation[] | null | undefined,
): ResolvedEventPlace | null {
  if (eventAttendanceMode(event) === 'online') return null
  const place = event.place
  if (!place?.kind) return null

  if (place.kind === 'location') {
    const loc = (siteLocations ?? []).find((l) => l?.key && l.key === place.locationKey)
    if (!loc) return null
    return {
      source: 'location',
      name: loc.name,
      address: loc.address,
      mapsLink: getLocationMapsLink(loc),
      pin: validPin(loc.pin),
    }
  }

  if (place.kind === 'venue') {
    const v = place.venue
    if (!v) return null
    return {
      source: 'venue',
      name: v.name,
      address: v.address,
      mapsLink: getLocationMapsLink({ mapsUrl: v.mapsUrl, pin: v.pin, address: v.address }),
      pin: validPin(v.pin),
      timeZone: v.timeZone || undefined,
    }
  }
  return null
}

/** The zone the event is shown in: venue → website → undefined (server zone). */
export function eventTimeZone(place: ResolvedEventPlace | null, site: EventSiteContext | null | undefined): string | undefined {
  return resolveTimeZone(place?.timeZone, site?.timeZone)
}

/** One-line address, e.g. "Via Roma 1, 48015 Cervia, IT". */
export function formatAddressLine(address: BusinessLocation | undefined): string | undefined {
  if (!address) return undefined
  const cityPart = [address.postalCode, address.city].filter(Boolean).join(' ')
  const line = [address.street, cityPart, address.state, address.country].filter(Boolean).join(', ')
  return line || undefined
}

const SCHEMA_STATUS: Record<EventLifecycleStatus, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
  // schema.org has no "sold out" event status: the event still happens, and
  // sold out is a property of its offers (availability), set below.
  soldOut: 'https://schema.org/EventScheduled',
}

const SCHEMA_ATTENDANCE: Record<EventAttendanceMode, string> = {
  inPerson: 'https://schema.org/OfflineEventAttendanceMode',
  online: 'https://schema.org/OnlineEventAttendanceMode',
  mixed: 'https://schema.org/MixedEventAttendanceMode',
}

export interface EventSchemaInput {
  event: Event
  place: ResolvedEventPlace | null
  /** Canonical URL of this event page, or undefined when unknown. */
  url?: string
  /** Canonical origin (https://domain) — links the organiser entity by @id. */
  origin?: string | null
  locale: string
  imageUrl?: string | null
  organizerName?: string | null
}

/**
 * Schema.org `Event` for one event page (Google event rich results). Pure.
 * Nothing is asserted that is not authored: no location key without a place
 * or a free-text location, no offers without prices, no image without one.
 * Returns null for an event that must not be described (unlisted) or that
 * lacks the two facts Google requires (name, startDate).
 */
export function buildEventSchema(input: EventSchemaInput): Record<string, unknown> | null {
  const { event, place, url, origin, locale } = input
  if (!eventIsIndexable(event)) return null
  if (!event.title || !event.startDate) return null

  const status = eventLifecycleStatus(event)
  const mode = eventAttendanceMode(event)

  const physical = place
    ? {
        '@type': 'Place',
        ...(place.name && { name: place.name }),
        ...(place.address && {
          address: {
            '@type': 'PostalAddress',
            ...(place.address.street && { streetAddress: place.address.street }),
            ...(place.address.city && { addressLocality: place.address.city }),
            ...(place.address.postalCode && { postalCode: place.address.postalCode }),
            ...(place.address.state && { addressRegion: place.address.state }),
            ...(place.address.country && { addressCountry: place.address.country }),
          },
        }),
        ...(place.pin && { geo: { '@type': 'GeoCoordinates', latitude: place.pin.lat, longitude: place.pin.lng } }),
      }
    : event.location
      ? { '@type': 'Place', name: event.location }
      : undefined

  const virtual =
    mode !== 'inPerson' && url ? { '@type': 'VirtualLocation', url } : undefined

  const location =
    physical && virtual ? [physical, virtual] : (physical ?? virtual)

  const prices = validPriceOptions(event.priceOptions)
  const availability = status === 'soldOut' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
  const offers =
    prices.length > 0
      ? prices.map((o) => ({
          '@type': 'Offer',
          ...(o.label && { name: o.label }),
          price: o.amount,
          priceCurrency: (o.currency?.trim() || DEFAULT_CURRENCY).toUpperCase(),
          availability,
          ...(url && { url }),
        }))
      : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    ...(url && { '@id': `${url}#event`, url }),
    name: event.title,
    inLanguage: locale,
    startDate: event.startDate,
    ...(event.endDate && { endDate: event.endDate }),
    eventStatus: SCHEMA_STATUS[status],
    eventAttendanceMode: SCHEMA_ATTENDANCE[mode],
    ...(location && { location }),
    ...(event.shortDescription && { description: event.shortDescription }),
    ...(input.imageUrl && { image: [input.imageUrl] }),
    ...(offers && { offers }),
    ...(event.hosts && event.hosts.length > 0 && {
      performer: event.hosts.filter((h) => h?.name).map((h) => ({ '@type': 'Person', name: h.name })),
    }),
    ...(origin
      ? { organizer: { '@id': `${origin}#organization` } }
      : input.organizerName
        ? { organizer: { '@type': 'Organization', name: input.organizerName } }
        : {}),
  }
}
