// ── Event v1 — the contract partners receive (ADR-031 D3) ─────────────────────
//
// Pure mapping from a published Sanity event to the versioned partner shape.
// schema.org-based names, every site language, ids that are never Sanity
// `_id`s, no website-only field (live-stream URLs, featured flags, schedule,
// gallery, internal notes) — those are not even fetched (EVENT_V1_PROJECTION).
//
// v1 is additive-only (D8.6): a field may be added, never renamed, retyped or
// removed. A breaking change is v2.

import { LIFECYCLE_PUBLIC_RULES } from '@/lib/lifecycle/public-types'
import { canonicalUrl } from '@/lib/seo/canonical'
import { lifecycleRemovalAt } from './sync'
import { resolveTimeZone } from '@/lib/time/zones'

export type Localized = Record<string, string>

export interface EventV1 {
  id: string
  url: Localized
  createdAt: string
  updatedAt: string
  timeZone: string | null
  name: Localized
  description: Localized
  startDate: string | null
  endDate: string | null
  eventStatus: 'scheduled' | 'cancelled' | 'postponed' | 'soldOut'
  attendanceMode: 'inPerson' | 'online' | 'mixed'
  location: {
    name: Localized
    text: Localized
    address: { street?: string; postalCode?: string; city?: string; region?: string; country?: string } | null
    geo: { latitude: number; longitude: number } | null
    venueId: string | null
  } | null
  image: { url: string; width: number | null; height: number | null; alt: Localized; focalPoint: { x: number; y: number } | null } | null
  offers: { name: Localized; price: number; currency: string; availability: 'InStock' | 'SoldOut' }[]
  inLanguage: string[]
  performers: { name: string; role: Localized }[]
}

export interface EventRemovedV1 {
  id: string
  deleted: true
  /**
   * Why it is gone. Consumers must accept reasons they do not know (v1 may add
   * more) and act on `deleted: true` alone. 'archived' added by ADR-032 D11.
   */
  reason: 'deleted' | 'unpublished' | 'unlisted' | 'websiteOnly' | 'archived'
  updatedAt: string
}

/** What the API needs to know about the website (siteConfig + project). */
export interface EventSiteV1 {
  locales: string[]
  defaultLocale: string
  timeZone: string | null
  origin: string | null
  locations: { key: string; name: unknown; address?: Record<string, unknown> | null; pin?: { lat?: number; lng?: number } | null }[]
}

/**
 * GROQ projection for Event v1 — raw localized objects (all languages), the
 * fields the contract needs and nothing else. A venue is dereferenced only
 * when it belongs to the same project.
 */
export const EVENT_V1_FIELDS = /* groq */ `
  publicId,
  _createdAt,
  _updatedAt,
  publishedAt,
  expiresAt,
  archivedAt,
  visibility,
  eventStatus,
  attendanceMode,
  title,
  slug,
  shortDescription,
  location,
  startDate,
  endDate,
  heroImage {
    "url": asset->url,
    "width": asset->metadata.dimensions.width,
    "height": asset->metadata.dimensions.height,
    hotspot { x, y },
    alt
  },
  priceOptions[] { label, amount, currency },
  hosts[] { name, role },
  place {
    kind,
    locationKey,
    "venue": select(venue->projectSlug == $projectSlug => venue->{ publicId, name, address, pin, timeZone })
  }
`

/** The projection itself. Lifecycle dates (ADR-032) are read to decide state; they are not part of Event v1. */
export const EVENT_V1_PROJECTION = /* groq */ `{${EVENT_V1_FIELDS}}`

/** The raw shape EVENT_V1_PROJECTION returns. */
export interface EventV1Row {
  publicId?: string | null
  _createdAt?: string
  _updatedAt?: string
  publishedAt?: string | null
  expiresAt?: string | null
  archivedAt?: string | null
  /** Effective change time in ms (the page query's sort key; ADR-032 D11). */
  _eff?: number | null
  visibility?: string | null
  eventStatus?: string | null
  attendanceMode?: string | null
  title?: unknown
  slug?: Record<string, { current?: string } | string | null> | null
  shortDescription?: unknown
  location?: unknown
  startDate?: string | null
  endDate?: string | null
  heroImage?: { url?: string | null; width?: number | null; height?: number | null; hotspot?: { x?: number; y?: number } | null; alt?: unknown } | null
  priceOptions?: { label?: unknown; amount?: unknown; currency?: unknown }[] | null
  hosts?: { name?: unknown; role?: unknown }[] | null
  place?: {
    kind?: string | null
    locationKey?: string | null
    venue?: { publicId?: string | null; name?: unknown; address?: Record<string, unknown> | null; pin?: { lat?: number; lng?: number } | null; timeZone?: string | null } | null
  } | null
}

const STATUSES = new Set(['scheduled', 'cancelled', 'postponed', 'soldOut'])
const MODES = new Set(['inPerson', 'online', 'mixed'])

/** Only the site's languages, only non-empty strings, no Sanity `_type`/`_key`. */
export function localizedMap(value: unknown, locales: readonly string[]): Localized {
  const out: Localized = {}
  if (typeof value === 'string') {
    if (value.trim() && locales[0]) out[locales[0]] = value
    return out
  }
  if (!value || typeof value !== 'object') return out
  for (const l of locales) {
    const v = (value as Record<string, unknown>)[l]
    if (typeof v === 'string' && v.trim()) out[l] = v
  }
  return out
}

function address(a: Record<string, unknown> | null | undefined): NonNullable<EventV1['location']>['address'] {
  if (!a || typeof a !== 'object') return null
  const s = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string) : undefined)
  const out = { street: s('street'), postalCode: s('postalCode'), city: s('city'), region: s('state'), country: s('country') }
  return Object.values(out).some(Boolean) ? JSON.parse(JSON.stringify(out)) : null
}

function geo(pin: { lat?: unknown; lng?: unknown } | null | undefined) {
  if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null
  return { latitude: pin.lat, longitude: pin.lng }
}

/**
 * Whether partners see an event at the window end `w`, and if not why:
 * the lifecycle first (ADR-032 — archived, then unpublished: expired or not yet
 * public), then visibility (ADR-031 D7 — unlisted, websiteOnly).
 */
export function partnerRemovalReason(
  row: Pick<EventV1Row, 'visibility' | 'publishedAt' | 'expiresAt' | 'archivedAt'>,
  w: Date
): EventRemovedV1['reason'] | null {
  const lifecycle = lifecycleRemovalAt(row, LIFECYCLE_PUBLIC_RULES.event, w)
  if (lifecycle) return lifecycle
  if (row.visibility === 'unlisted') return 'unlisted'
  if (row.visibility === 'websiteOnly') return 'websiteOnly'
  return null
}

export function toEventV1(row: EventV1Row, site: EventSiteV1): EventV1 | null {
  if (!row.publicId || !row._createdAt || !row._updatedAt) return null
  const locales = site.locales
  const status = STATUSES.has(row.eventStatus ?? '') ? (row.eventStatus as EventV1['eventStatus']) : 'scheduled'
  const mode = MODES.has(row.attendanceMode ?? '') ? (row.attendanceMode as EventV1['attendanceMode']) : 'inPerson'

  const url: Localized = {}
  for (const l of locales) {
    const s = row.slug?.[l]
    const current = typeof s === 'string' ? s : s?.current
    const u = current ? canonicalUrl(site.origin, l as never, 'events', current) : undefined
    if (u) url[l] = u
  }

  let location: EventV1['location'] = null
  if (mode !== 'online') {
    const v = row.place?.kind === 'venue' ? row.place.venue : null
    const siteLoc = row.place?.kind === 'location' ? site.locations.find((x) => x.key && x.key === row.place?.locationKey) : null
    const text = localizedMap(row.location, locales)
    if (v) location = { name: localizedMap(v.name, locales), text, address: address(v.address), geo: geo(v.pin), venueId: v.publicId ?? null }
    else if (siteLoc) location = { name: localizedMap(siteLoc.name, locales), text, address: address(siteLoc.address ?? null), geo: geo(siteLoc.pin), venueId: null }
    else if (Object.keys(text).length) location = { name: {}, text, address: null, geo: null, venueId: null }
  }

  const img = row.heroImage
  const image =
    img?.url && /^https:\/\//.test(img.url)
      ? {
          url: img.url,
          width: typeof img.width === 'number' ? img.width : null,
          height: typeof img.height === 'number' ? img.height : null,
          alt: localizedMap(img.alt, locales),
          focalPoint: typeof img.hotspot?.x === 'number' && typeof img.hotspot?.y === 'number' ? { x: img.hotspot.x, y: img.hotspot.y } : null,
        }
      : null

  const offers: EventV1['offers'] = []
  for (const o of row.priceOptions ?? []) {
    if (typeof o?.amount !== 'number' || !Number.isFinite(o.amount) || o.amount < 0) continue
    offers.push({
      name: localizedMap(o.label, locales),
      price: o.amount,
      currency: (typeof o.currency === 'string' && o.currency.trim() ? o.currency : 'eur').trim().toUpperCase(),
      availability: status === 'soldOut' ? 'SoldOut' : 'InStock',
    })
  }

  const performers = (row.hosts ?? [])
    .filter((h) => typeof h?.name === 'string' && h.name.trim())
    .map((h) => ({ name: (h.name as string).trim(), role: localizedMap(h.role, locales) }))

  const venueZone = row.place?.kind === 'venue' ? row.place.venue?.timeZone : null
  return {
    id: row.publicId,
    url,
    createdAt: row._createdAt,
    updatedAt: row._updatedAt,
    timeZone: resolveTimeZone(venueZone, site.timeZone) ?? null,
    name: localizedMap(row.title, locales),
    description: localizedMap(row.shortDescription, locales),
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    eventStatus: status,
    attendanceMode: mode,
    location,
    image,
    offers,
    inLanguage: locales.filter((l) => url[l] || localizedMap(row.title, [l])[l]),
    performers,
  }
}
