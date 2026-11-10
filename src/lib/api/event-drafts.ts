/**
 * Client dashboard — events (Events module, client-usable, slice 1).
 *
 * Same model as galleries and posts: edits go to a DRAFT (`drafts.<eventId>`)
 * and only "Publish changes" changes the website.
 *
 * Slice 1 covers the facts a client changes themselves: title, short
 * description, place, start/end, the sign-up link and the cover photo (from
 * the Media Library). Everything else on an event (full description, schedule,
 * hosts, prices, photos, streaming, featuring) is kept exactly as it is — a
 * draft is a full copy of the published event and publishing writes it back
 * whole — and is still edited in Studio.
 *
 * Enforcement (as gallery-drafts / post-drafts):
 *   1. `assertModuleAction(ctx, projectId, events.event.read|write)` before any
 *      I/O; identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `event`s of the grant's project — anything else
 *      is "not_found", so ids can't be probed.
 *   3. Patch allowlist (EVENT_TEXT_FIELDS.<loc>, startDate, endDate,
 *      registrationUrl), site languages only, length limits; the cover must
 *      be a `mediaAsset` of this project.
 *      `categories` (ADR-033 Amendment J) takes keys the site offers: its
 *      taxonomyTerm records, else the old module-config list.
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (EventErrorCode).
 *   6. ADR-032 Phase 3 — events adopt the content lifecycle: Publish (now /
 *      "Publish on…" / "Unpublish on…"), Unpublish, Publish again, Archive,
 *      Restore and Delete permanently run through the one lifecycle service
 *      (`runEventLifecycle`, `setEventDates`); the status shown is derived
 *      from publishedAt / expiresAt / archivedAt by `deriveStatus`. An event's
 *      own `eventStatus` (cancelled, postponed…) and `visibility` are
 *      separate: they never change publication, and publication never
 *      changes them. Past events are never archived automatically.
 */
import { randomUUID } from 'crypto'
import { eventTiming as sharedEventTiming } from '@/lib/modules/events/timing'
import {
  attendanceModeAllowed,
  eventFieldAllowed,
  placeTokenAllowed,
  resolveEventCapabilities,
  type EventCapabilities,
} from '@/lib/modules/events/capabilities'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { personRefIds, personRefs } from '@/lib/api/persons-guard'
import { PEOPLE_READ_PERMISSION, PersonError } from '@/lib/api/persons-lifecycle'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import * as lifecycle from '@/lib/lifecycle/service'
import { deriveStatus, type LifecycleStatus } from '@/lib/lifecycle/status'
import { readContentActivity, type ActivityItem } from '@/lib/lifecycle/activity'
import type { LifecycleFields } from '@/lib/lifecycle/visibility'
import { lifecycleAction, snapshotOf as publishedSnapshotOf } from '@/lib/lifecycle/transition'
import { coverThumbUrl } from '@/lib/api/post-drafts'
import { eventPlaceName } from '@/lib/modules/events/structured'
import type { EventAttendanceMode, SiteLocation } from '@/lib/sanity/types'
import { slugFromTitle, uniqueSlug } from '@/lib/api/post-publish'
import { factsOfPublishedEvent, syncEventSchedule } from '@/lib/scheduling/sync.server'
import { EVENT_VOCABULARY_QUERY, eventCategoryOptions, type EventCategoryOption, type RawEventVocabulary } from '@/lib/modules/events/categories'

export const EVENT_READ_PERMISSION = 'events.event.read'
export const EVENT_WRITE_PERMISSION = 'events.event.write'
/** Removing a never-published event (discarding its only draft). */
export const EVENT_DELETE_PERMISSION = 'events.event.delete'

export const EVENT_LIMITS = {
  title: 160,
  shortDescription: 500,
  location: 160,
  registrationLabel: 40,
  url: 500,
  patchBytes: 50_000,
  /** Event documents (drafts + published) per project — caps createEvent abuse. */
  events: 1000,
} as const

/** Localized text fields the dashboard may change, with their max length. */
export const EVENT_TEXT_FIELDS: Record<string, { max: number; type: 'localizedString' | 'localizedText' }> = {
  title: { max: EVENT_LIMITS.title, type: 'localizedString' },
  shortDescription: { max: EVENT_LIMITS.shortDescription, type: 'localizedText' },
  location: { max: EVENT_LIMITS.location, type: 'localizedString' },
  registrationLabel: { max: EVENT_LIMITS.registrationLabel, type: 'localizedString' },
}

/** ADR-031 — choice fields the dashboard may change, with their allowed values. */
export const EVENT_CHOICE_FIELDS = {
  visibility: ['public', 'websiteOnly', 'unlisted'],
  eventStatus: ['scheduled', 'cancelled', 'postponed', 'soldOut'],
  attendanceMode: ['inPerson', 'online', 'mixed'],
} as const satisfies Record<string, readonly string[]>
type ChoiceField = keyof typeof EVENT_CHOICE_FIELDS
const isChoiceField = (f: string): f is ChoiceField => Object.prototype.hasOwnProperty.call(EVENT_CHOICE_FIELDS, f)

/**
 * ADR-031 D6 — the place as the editor sends it: `''` (none — the free-text
 * "Where" is used), `location:<key>` (one of the site's locations) or
 * `venue:<id>` (a saved venue of this project).
 */
export type EventPlaceToken = string
/** Hosts from the People module on one event; mirrors the schema's max (ADR-043). */
export const MAX_EVENT_HOST_PEOPLE = 50
/** An event can carry this many categories at most. */
const MAX_EVENT_CATEGORIES = 50
const PLACE_TOKEN = /^(location:[a-z0-9_-]{1,64}|venue:[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/

export type EventPlaceOptions = {
  locations: { key: string; name: string }[]
  venues: { id: string; name: string }[]
}

export type EventErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'missing_title'
  | 'missing_date'
  | 'bad_dates'
  /** The event is archived: restore it first (ADR-032). */
  | 'archived'
  /** Published (or once published) events are archived before they are deleted for good. */
  | 'archive_first'
  /** Something on the website still uses the event (`detail.usedIn`). */
  | 'in_use'
  /** The "Publish on" / "Unpublish on" date is missing, in the past or more than two years away. */
  | 'invalid_schedule'
  | 'failed'

/** Where an event is still used (an `in_use` refusal). */
export interface EventUsage {
  kind: 'page' | 'post' | 'course' | 'event' | 'other'
  /** Sanity document id (base id). */
  id: string
  title: string
}

export class EventError extends Error {
  constructor(
    readonly code: EventErrorCode,
    message: string,
    /** in_use → what still uses the event. */
    readonly detail?: { usedIn?: EventUsage[] }
  ) {
    super(message)
    this.name = 'EventError'
  }
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type EventDeps = {
  client?: Client
  now?: () => Date
  uuid?: () => string
  audit?: ContentAuditWriter
  /** ADR-038 C6a — writes the schedule after a publish. Tests inject a fake; null skips it. */
  syncSchedule?: typeof syncEventSchedule | null
  /** Reads an item's Activity (tests inject a fake). */
  read?: typeof readContentActivity
}

/** Activity rows of an event are keyed by its publicId (ADR-032 D9), else its _id. */
const eventContentId = (doc: Record<string, unknown> | null | undefined, id: string) =>
  typeof doc?.publicId === 'string' && doc.publicId ? doc.publicId : id

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])

export function isEventId(id: unknown): id is string {
  return typeof id === 'string' && EVENT_ID.test(id) && id !== 'new'
}

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new EventError('not_found', 'Unknown event.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'event' && doc.projectSlug === projectSlug)
}

async function readPair(client: Client, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [
    Doc | undefined,
    Doc | undefined,
  ]
  if ((published && !ours(published, projectSlug)) || (draft && !ours(draft, projectSlug))) notFound()
  return { published, draft }
}

/** The single-project guard as a promise, so an autosave can run it alongside its reads. */
const singleProjectGuard = (client: Client, projectSlug: string) => assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)

/** One mutation behind the single-project guard; `guard` = that check already started, awaited before the write. */
async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>, guard?: Promise<void>): Promise<unknown> {
  await (guard ?? singleProjectGuard(client, projectSlug))
  try {
    return await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      throw new EventError('conflict', 'This event was changed elsewhere.')
    }
    throw new EventError('failed', 'Could not save.')
  }
}

export function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

const pick = (value: unknown, locale: string): string => {
  const v = localized(value)
  return v[locale] ?? v.en ?? Object.values(v)[0] ?? ''
}

/** timeZone: the site's IANA zone (null = not set; the dashboard falls back to the viewer's). Event times are entered in it. */
export type EventSite = { defaultLocale: string; locales: string[]; timeZone: string | null }

async function readSite(client: Client, projectSlug: string): Promise<EventSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null; timeZone?: string | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales, timeZone }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new EventError('failed', 'Site languages are not configured.')
  return { defaultLocale, locales: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)], timeZone: typeof site?.timeZone === 'string' && site.timeZone ? site.timeZone : null }
}

/** The site's languages for an event that doesn't exist yet. Same gate as creating one. */
export async function getEventSite(ctx: TenantAuthorizationContext, projectId: string, deps: EventDeps = {}): Promise<EventSite> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  return readSite(deps.client ?? sanityWriteClient, grant.projectSlug)
}

// ── Lifecycle state (ADR-032) ─────────────────────────────────────────────────

const isoOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const archivedAtOf = (doc: LifecycleFields | Record<string, unknown> | null | undefined): string | null => isoOf((doc as Record<string, unknown> | null | undefined)?.archivedAt)
const publishedAtOf = (doc: LifecycleFields | Record<string, unknown> | null | undefined): string | null => isoOf((doc as Record<string, unknown> | null | undefined)?.publishedAt)
const expiresAtOf = (doc: LifecycleFields | Record<string, unknown> | null | undefined): string | null => isoOf((doc as Record<string, unknown> | null | undefined)?.expiresAt)

/** Lifecycle fields a draft never carries into a publish (the publish sets them from the published version and the chosen dates). */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])

/**
 * An event's publication state (ADR-032 D4), separate from its `eventStatus`
 * and `visibility`. Derived from the PUBLISHED version only (what the website
 * shows); `hasChanges` = a draft sits next to it. No stored status; absent
 * fields = published (the 'optional' rule: existing events stay live).
 */
export type EventLifecycle = {
  status: LifecycleStatus
  /** A draft with changes sits next to the published version. */
  hasChanges: boolean
  /** The published version's go-live date (ISO) — set when it carries one. */
  publishedAt: string | null
  /** A future unpublish date (ISO), or null. */
  unpublishOn: string | null
  archivedAt: string | null
}

export function eventLifecycleOf(published: LifecycleFields | Record<string, unknown> | null | undefined, hasDraft: boolean, now: Date): EventLifecycle {
  const fields: LifecycleFields | null = published ? { publishedAt: publishedAtOf(published), expiresAt: expiresAtOf(published), archivedAt: archivedAtOf(published) } : null
  const s = deriveStatus({ published: fields, draft: hasDraft ? true : null, rule: 'optional' }, now)
  return { status: s.status, hasChanges: s.hasChanges, publishedAt: fields?.publishedAt ?? null, unpublishOn: s.unpublishOn, archivedAt: fields?.archivedAt ?? null }
}

/** How far ahead a "Publish on" / "Unpublish on" date may lie (the same two years as every module). */
export const EVENT_MAX_SCHEDULE_MS = lifecycle.MAX_SCHEDULE_AHEAD_MS
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/** "Publish on": a real moment in the future, within two years. */
export function parseEventPublishAt(value: unknown, now: Date): Date {
  const at = typeof value === 'string' && ISO.test(value) ? new Date(value) : null
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= now.getTime() || at.getTime() - now.getTime() > EVENT_MAX_SCHEDULE_MS) {
    throw new EventError('invalid_schedule', 'Pick a date and time in the future, within two years.')
  }
  return at
}

/** "Unpublish on": in the future, within two years, and after the go-live date when there is one. ISO UTC. */
export function parseEventUnpublishAt(value: unknown, now: Date, goLive: string | null): string {
  const at = typeof value === 'string' && ISO.test(value) ? new Date(value) : null
  if (
    !at ||
    Number.isNaN(at.getTime()) ||
    at.getTime() <= now.getTime() ||
    at.getTime() - now.getTime() > EVENT_MAX_SCHEDULE_MS ||
    (goLive !== null && at.getTime() <= Date.parse(goLive))
  ) {
    throw new EventError('invalid_schedule', 'Pick a date and time in the future, after the publish date.')
  }
  return at.toISOString()
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/** A real ISO date-time (what the date pickers send), normalised; else throws invalid_value. */
export function parseEventDate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    throw new EventError('invalid_value', 'Not a date.')
  }
  const t = Date.parse(value)
  if (Number.isNaN(t)) throw new EventError('invalid_value', 'Not a date.')
  const year = new Date(t).getUTCFullYear()
  if (year < 2000 || year > 2100) throw new EventError('invalid_value', 'Date out of range.')
  return new Date(t).toISOString()
}

/** "upcoming" / "past" from the dates; an event Abluo set to "live" stays live (shared rule, events/timing.ts). */
export function eventTiming(doc: Record<string, unknown>, now: Date): 'upcoming' | 'live' | 'past' {
  return sharedEventTiming(doc, now)
}

/** Accepted sign-up links: https/http/mailto, or a path on this site ("/contact"). */
export function cleanRegistrationUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > EVENT_LIMITS.url) throw new EventError('invalid_value', 'Bad link.')
  const v = value.trim()
  if (!v) return ''
  // Protocol-relative ("//host") would leave the site; a backslash can be read as a slash.
  if (v.startsWith('//') || v.includes('\\')) throw new EventError('invalid_value', 'Bad link.')
  if (/^\/(?!\/)[^\s]*$/.test(v)) return v
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`)
  } catch {
    throw new EventError('invalid_value', 'Bad link.')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
    throw new EventError('invalid_value', 'Bad link.')
  }
  return url.toString()
}

// ── List ──────────────────────────────────────────────────────────────────────

export type EventListItem = {
  id: string
  /** In the site's default language (the draft's when there is one). */
  title: string
  /** Where: the picked site location's or saved venue's name, else the free-text "Where" (default language). */
  location: string
  startDate: string | null
  endDate: string | null
  timing: 'upcoming' | 'live' | 'past'
  coverThumb: string | null
  hasDraft: boolean
  isPublished: boolean
  updatedAt: string
  /** ADR-033 Amendment J — the stored category keys (names come from the vocabulary). */
  categories: string[]
  /** ADR-032 — Draft · Scheduled · Published · Unpublished · Archived, from the published version's dates. */
  lifecycle: EventLifecycle
}

const LIST_QUERY = /* groq */ `*[_type == "event" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _updatedAt, title, location, startDate, endDate, status, categories, attendanceMode,
    publishedAt, expiresAt, archivedAt,
    "place": place{ kind, locationKey, "venueName": select(venue->projectSlug == $projectSlug => venue->name) },
    "coverUrl": heroImage.asset->url, "coverHotspot": heroImage.hotspot
  }`

type ListRow = {
  _id: string
  _updatedAt?: string
  title?: unknown
  location?: unknown
  attendanceMode?: unknown
  place?: { kind?: unknown; locationKey?: unknown; venueName?: unknown } | null
  startDate?: string | null
  endDate?: string | null
  status?: string | null
  coverUrl?: string | null
  coverHotspot?: { x?: number; y?: number } | null
  categories?: unknown
  publishedAt?: string | null
  expiresAt?: string | null
  archivedAt?: string | null
}

/** This project's events (draft shown over published), upcoming first by date, then past newest first. Read permission. */
export async function listEvents(ctx: TenantAuthorizationContext, projectId: string, deps: EventDeps = {}): Promise<EventListItem[]> {
  const grant = grantFor(ctx, projectId, EVENT_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const [rows, places] = await Promise.all([readListRows(client, grant.projectSlug), readPlaceOptions(client, grant.projectSlug, site.defaultLocale)])
  return listItemsOf(rows, site, (deps.now ?? (() => new Date()))(), places.locations)
}

/** The Events list screen: the events, plus the categories they can carry (to label and filter them) and the site's default language. */
export type EventListScreen = { events: EventListItem[]; categoryOptions: EventCategoryOption[]; defaultLocale: string; timeZone: string | null }

/**
 * As `listEvents`, plus the project's event categories. Three reads in
 * parallel, one each (events — category KEYS only —, site, vocabulary): no
 * per-event lookup; the dashboard turns keys into names from the vocabulary.
 */
export async function listEventsWithCategories(ctx: TenantAuthorizationContext, projectId: string, deps: EventDeps = {}): Promise<EventListScreen> {
  const grant = grantFor(ctx, projectId, EVENT_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const [site, rows, categoryOptions] = await Promise.all([readSite(client, grant.projectSlug), readListRows(client, grant.projectSlug), readCategoryOptions(client, grant.projectSlug)])
  const places = await readPlaceOptions(client, grant.projectSlug, site.defaultLocale)
  return { events: listItemsOf(rows, site, (deps.now ?? (() => new Date()))(), places.locations), categoryOptions, defaultLocale: site.defaultLocale, timeZone: site.timeZone }
}

async function readListRows(client: Client, projectSlug: string): Promise<ListRow[]> {
  return (await client.fetch<ListRow[] | null>(LIST_QUERY, { projectSlug }, { perspective: 'raw' })) ?? []
}

/**
 * ADR-031 — "Where" for the list: the place resolved by the website's own rule
 * (resolveEventPlace, via eventPlaceName), named in the site's default
 * language; the free-text location when there is no place.
 */
function listLocationOf(row: ListRow, defaultLocale: string, locations: EventPlaceOptions['locations']): string {
  const p = row.place
  const kind = p?.kind === 'location' || p?.kind === 'venue' ? p.kind : undefined
  const venueName = kind === 'venue' && p?.venueName != null ? pick(p.venueName, defaultLocale) : ''
  const siteLocations: SiteLocation[] = locations.map((l) => ({ _key: l.key, key: l.key, name: l.name }))
  return eventPlaceName(
    {
      attendanceMode: typeof row.attendanceMode === 'string' ? (row.attendanceMode as EventAttendanceMode) : undefined,
      place: kind
        ? {
            kind,
            locationKey: typeof p?.locationKey === 'string' ? p.locationKey : undefined,
            venue: kind === 'venue' && p?.venueName != null ? { name: venueName || undefined } : null,
          }
        : null,
      location: pick(row.location, defaultLocale) || undefined,
    },
    siteLocations,
  ) ?? ''
}

function listItemsOf(rows: readonly ListRow[], site: EventSite, now: Date, locations: EventPlaceOptions['locations'] = []): EventListItem[] {
  const byId = new Map<string, { published?: ListRow; draft?: ListRow }>()
  for (const row of rows) {
    if (typeof row?._id !== 'string') continue
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    if (!isEventId(id)) continue
    const entry = byId.get(id) ?? {}
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }

  const items: EventListItem[] = []
  for (const [id, { published, draft }] of byId) {
    const row = (draft ?? published)!
    items.push({
      id,
      title: pick(row.title, site.defaultLocale),
      location: listLocationOf(row, site.defaultLocale, locations),
      startDate: typeof row.startDate === 'string' ? row.startDate : null,
      endDate: typeof row.endDate === 'string' ? row.endDate : null,
      timing: eventTiming(row, now),
      coverThumb: coverThumbUrl(row.coverUrl, row.coverHotspot),
      hasDraft: Boolean(draft),
      isPublished: Boolean(published),
      updatedAt: row._updatedAt ?? '',
      categories: categoryKeysOfDoc({ categories: row.categories }),
      lifecycle: eventLifecycleOf(published, Boolean(draft), now),
    })
  }
  return sortEvents(items)
}

/** Live and upcoming first (soonest first), then past (most recent first); undated last. */
export function sortEvents<T extends Pick<EventListItem, 'timing' | 'startDate' | 'title'>>(items: T[]): T[] {
  const time = (i: T) => (i.startDate ? Date.parse(i.startDate) : NaN)
  const rank = (i: T) => (i.timing === 'past' ? 1 : 0)
  return [...items].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const ta = time(a)
    const tb = time(b)
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
    if (!Number.isNaN(ta) && ta !== tb) return rank(a) === 0 ? ta - tb : tb - ta
    return a.title.localeCompare(b.title)
  })
}

// ── One event ─────────────────────────────────────────────────────────────────

/**
 * The event's cover. `focal` is the point the website keeps in view: the
 * event's own (heroImage.hotspot) when set, else the Media Library photo's.
 */
export type EventCover = { assetId: string; url: string; thumbUrl: string | null; alt: Record<string, string>; focal: { x: number; y: number } | null }

/** Hotspot ellipse size written with a focal point (Sanity requires one; same as post covers). */
const COVER_HOTSPOT_SIZE = 0.3

function focalOf(hotspot: unknown): { x: number; y: number } | null {
  const h = hotspot as { x?: unknown; y?: unknown } | null | undefined
  return h && typeof h.x === 'number' && typeof h.y === 'number' && Number.isFinite(h.x) && Number.isFinite(h.y) ? { x: h.x, y: h.y } : null
}

/** A focal point as sent by the editor: finite x and y in 0..1, rounded to 4 decimals; else invalid_value. */
export function parseEventFocal(value: unknown): { x: number; y: number } {
  const v = value as { x?: unknown; y?: unknown } | null
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  if (!v || typeof v !== 'object' || Array.isArray(v) || !ok(v.x) || !ok(v.y)) throw new EventError('invalid_value', 'Focal point must be x and y between 0 and 1.')
  const r = (n: number) => Math.round(n * 10000) / 10000
  return { x: r(v.x), y: r(v.y) }
}

export type EventSnapshot = {
  id: string
  /** The draft's revision ('' when there is no draft yet — the first change opens one). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  site: EventSite
  title: Record<string, string>
  shortDescription: Record<string, string>
  location: Record<string, string>
  registrationLabel: Record<string, string>
  registrationUrl: string
  startDate: string | null
  endDate: string | null
  timing: 'upcoming' | 'live' | 'past'
  cover: EventCover | null
  /** Public path of the published event in the default language (no locale prefix), or null. */
  publicSlug: string | null
  /** True when Studio-only content exists (full description, schedule, hosts, prices, photos) — shown as a hint. */
  hasStudioContent: boolean
  /** ADR-031 — absent on older events reads as the default. */
  visibility: (typeof EVENT_CHOICE_FIELDS.visibility)[number]
  eventStatus: (typeof EVENT_CHOICE_FIELDS.eventStatus)[number]
  attendanceMode: (typeof EVENT_CHOICE_FIELDS.attendanceMode)[number]
  place: EventPlaceToken
  placeOptions: EventPlaceOptions
  /** ADR-033 Amendment J — the stored category keys (text keys only), in the order stored. */
  categories: string[]
  /** The categories to choose from: the project's term records, else the old config list. */
  categoryOptions: EventCategoryOption[]
  /** ADR-038 D6 — what this project's client can use (Studio → Modules → Events). */
  capabilities: EventCapabilities
  /** ADR-043 — hosts from the People module in order: person document ids. */
  hostPeople: string[]
  /** ADR-043 — the old inline hosts (read-only in the dashboard; kept until migrated). */
  legacyHosts: { name: string; role: string }[]
  /** ADR-032 — publication state of the published version (separate from eventStatus and visibility). */
  lifecycle: EventLifecycle
  /** The PUBLIC id partners and Activity know the event by, when it has one. */
  publicId: string | null
}

function snapshotOf(id: string, doc: Doc, draft: Doc | undefined, published: Doc | undefined, site: EventSite, cover: EventCover | null, now: Date, placeOptions: EventPlaceOptions = { locations: [], venues: [] }, categoryOptions: EventCategoryOption[] = [], capabilities: EventCapabilities = resolveEventCapabilities(null)): EventSnapshot {
  const slug = (published?.slug as Record<string, { current?: unknown }> | undefined)?.[site.defaultLocale]?.current
  const nonEmpty = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && typeof v === 'object' ? Object.keys(v).some((k) => !k.startsWith('_')) : false)
  return {
    id,
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    site,
    title: localized(doc.title),
    shortDescription: localized(doc.shortDescription),
    location: localized(doc.location),
    registrationLabel: localized(doc.registrationLabel),
    registrationUrl: typeof doc.registrationUrl === 'string' ? doc.registrationUrl : '',
    startDate: typeof doc.startDate === 'string' ? doc.startDate : null,
    endDate: typeof doc.endDate === 'string' ? doc.endDate : null,
    timing: eventTiming(doc, now),
    cover,
    publicSlug: typeof slug === 'string' && slug ? slug : null,
    // With the Hosts capability on, inline hosts are shown in the editor (read-only), so they no longer count as Studio-only content.
    hasStudioContent: ['fullDescription', 'schedule', ...(capabilities.hosts ? [] : ['hosts']), 'priceOptions', 'gallery'].some((f) => nonEmpty(doc[f])),
    visibility: choice(doc, 'visibility'),
    eventStatus: choice(doc, 'eventStatus'),
    attendanceMode: choice(doc, 'attendanceMode'),
    place: placeTokenOf(doc.place),
    placeOptions,
    categories: categoryKeysOfDoc(doc),
    categoryOptions,
    capabilities,
    hostPeople: personRefIds(doc.hostPeople),
    legacyHosts: legacyHostsOf(doc.hosts, site.defaultLocale),
    lifecycle: eventLifecycleOf(published, Boolean(draft), now),
    publicId: isoOf(doc.publicId),
  }
}

/** The inline `hosts` as name + role (default language), for the read-only hint. */
function legacyHostsOf(value: unknown, defaultLocale: string): { name: string; role: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((h) => {
    const name = typeof (h as { name?: unknown })?.name === 'string' ? (h as { name: string }).name.trim() : ''
    return name ? [{ name, role: pick((h as { role?: unknown }).role, defaultLocale) }] : []
  })
}

/** The stored category keys of an event: text entries only (a legacy reference entry is not a key). */
export function categoryKeysOfDoc(doc: Record<string, unknown>): string[] {
  const raw = Array.isArray(doc.categories) ? doc.categories : []
  return Array.from(new Set(raw.filter((k): k is string => typeof k === 'string' && k !== '')))
}

/** The categories an event can be filed under (term records, else the old config list). */
async function readCategoryOptions(client: Client, projectSlug: string): Promise<EventCategoryOption[]> {
  const row = await client.fetch<RawEventVocabulary>(EVENT_VOCABULARY_QUERY, { projectSlug })
  return eventCategoryOptions(row)
}

function choice<F extends ChoiceField>(doc: Doc, field: F): (typeof EVENT_CHOICE_FIELDS)[F][number] {
  const allowed = EVENT_CHOICE_FIELDS[field] as readonly string[]
  const v = doc[field]
  return (typeof v === 'string' && allowed.includes(v) ? v : allowed[0]) as (typeof EVENT_CHOICE_FIELDS)[F][number]
}

/** The stored place as an editor token ('' when none or unreadable). */
export function placeTokenOf(place: unknown): EventPlaceToken {
  const p = place as { kind?: unknown; locationKey?: unknown; venue?: { _ref?: unknown } } | null | undefined
  if (p?.kind === 'location' && typeof p.locationKey === 'string' && p.locationKey) return `location:${p.locationKey}`
  if (p?.kind === 'venue' && typeof p.venue?._ref === 'string' && p.venue._ref) return `venue:${p.venue._ref}`
  return ''
}

const PLACE_OPTIONS_QUERY = /* groq */ `{
  "locations": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].locations[]{ key, name },
  "venues": *[_type == "eventVenue" && projectSlug == $projectSlug && !(_id in path("drafts.**"))] | order(_createdAt asc){ _id, name }
}`

/** The site's own locations and saved venues, named in the site's default language. */
async function readPlaceOptions(client: Client, projectSlug: string, defaultLocale: string): Promise<EventPlaceOptions> {
  const row = await client.fetch<{ locations?: unknown; venues?: unknown } | null>(PLACE_OPTIONS_QUERY, { projectSlug })
  const name = (v: unknown) => pick(v, defaultLocale)
  const locations = (Array.isArray(row?.locations) ? row.locations : [])
    .filter((l): l is { key: string; name?: unknown } => typeof (l as { key?: unknown })?.key === 'string')
    .map((l) => ({ key: l.key, name: name(l.name) || l.key }))
  const venues = (Array.isArray(row?.venues) ? row.venues : [])
    .filter((v): v is { _id: string; name?: unknown } => typeof (v as { _id?: unknown })?._id === 'string')
    .map((v) => ({ id: v._id, name: name(v.name) || v._id }))
  return { locations, venues }
}

const CAPABILITIES_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "events"][0].config`

/** ADR-038 D6 — the project's Events capabilities (defaults when nothing is stored). */
export async function readEventCapabilities(client: Pick<Client, 'fetch'>, projectSlug: string): Promise<EventCapabilities> {
  const config = await client.fetch<Record<string, unknown> | null>(CAPABILITIES_QUERY, { projectSlug })
  return resolveEventCapabilities(config && typeof config === 'object' ? config : null)
}

/** The place choices the client is offered: no saved venues when the Venues capability is off (the event's current venue stays visible). */
export function placeOptionsFor(options: EventPlaceOptions, caps: EventCapabilities, current: EventPlaceToken): EventPlaceOptions {
  const keepCurrent = (v: { id: string }) => current === `venue:${v.id}`
  return {
    locations: options.locations,
    venues: caps.venues === 'off' ? options.venues.filter(keepCurrent) : options.venues,
  }
}

async function readCover(client: Client, projectSlug: string, heroImage: unknown): Promise<EventCover | null> {
  const ref = (heroImage as { asset?: { _ref?: unknown } } | null | undefined)?.asset?._ref
  if (typeof ref !== 'string' || !ref.startsWith('image-')) return null
  const row = await client.fetch<{ _id?: string; url?: string | null; altText?: unknown; hotspot?: { x?: number; y?: number } | null } | null>(
    `*[_type == "mediaAsset" && projectSlug == $projectSlug && image.asset._ref == $ref && !(_id in path("drafts.**"))]
      | order(_createdAt desc)[0]{ _id, "url": image.asset->url, altText, "hotspot": image.hotspot }`,
    { projectSlug, ref }
  )
  const url = row?.url ?? (await client.fetch<string | null>(`*[_id == $ref][0].url`, { ref }))
  if (!url) return null
  const own = localized((heroImage as { alt?: unknown }).alt)
  // The event's own point first (it is what the website shows), else the library's.
  const focal = focalOf((heroImage as { hotspot?: unknown }).hotspot) ?? focalOf(row?.hotspot)
  return {
    assetId: row?._id ?? ref,
    url,
    thumbUrl: coverThumbUrl(url, focal, 480),
    alt: Object.keys(own).length ? own : localized(row?.altText),
    focal,
  }
}

/** The event as the editor shows it: the draft when there is one, else the published event. Read permission. */
export async function getEvent(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: EventDeps = {}): Promise<EventSnapshot> {
  const grant = grantFor(ctx, projectId, EVENT_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  const [cover, placeOptions, categoryOptions, capabilities] = await Promise.all([
    readCover(client, grant.projectSlug, doc.heroImage),
    readPlaceOptions(client, grant.projectSlug, site.defaultLocale),
    readCategoryOptions(client, grant.projectSlug),
    readEventCapabilities(client, grant.projectSlug),
  ])
  const offered = placeOptionsFor(placeOptions, capabilities, placeTokenOf(doc.place))
  return snapshotOf(id, doc, draft, published, site, cover, (deps.now ?? (() => new Date()))(), offered, categoryOptions, capabilities)
}

// ── Open / create ─────────────────────────────────────────────────────────────

/** Makes sure `drafts.<id>` exists — an exact copy of the published event. Returns the draft's revision. */
export async function openEventForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: EventDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (archivedAtOf(published) || archivedAtOf(draft)) throw new EventError('archived', 'Restore this event to edit it.')
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'event'
  copy.projectSlug = grant.projectSlug
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string } | undefined
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
    }
    throw new EventError('failed', 'Could not open the event.')
  }
}

/** A new, unpublished event (draft only): title in the site's main language and a start date. */
export async function createEvent(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { title?: string; startDate?: string },
  deps: EventDeps = {}
): Promise<{ id: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  return audited({ ctx, projectId, contentType: 'event', contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const raw = input?.title ?? ''
  if (typeof raw !== 'string' || raw.length > EVENT_LIMITS.title) throw new EventError('invalid_value', 'The title is too long.')
  const title = raw.trim().replace(/\s+/g, ' ')
  if (!title) throw new EventError('missing_title', 'Give the event a name.')
  const startDate = parseEventDate(input?.startDate)
  const site = await readSite(client, grant.projectSlug)
  // ADR-038 D6 — a new event starts with a way of attending this site offers.
  const caps = await readEventCapabilities(client, grant.projectSlug)
  const firstMode = (['inPerson', 'online', 'mixed'] as const).find((m) => caps.attendance[m]) ?? 'inPerson'
  const count = await client.fetch<number | null>(`count(*[_type == "event" && projectSlug == $projectSlug])`, { projectSlug: grant.projectSlug }, { perspective: 'raw' })
  if ((count ?? 0) >= EVENT_LIMITS.events) throw new EventError('too_large', 'This site has too many events.')
  const doc = {
    _id: `drafts.${id}`,
    _type: 'event',
    projectSlug: grant.projectSlug,
    title: { _type: 'localizedString', [site.defaultLocale]: title },
    startDate,
    status: eventTiming({ startDate }, (deps.now ?? (() => new Date()))()),
    // ADR-031 — the permanent id partners see; same defaults as Studio's template.
    publicId: randomUUID(),
    visibility: 'public',
    eventStatus: 'scheduled',
    attendanceMode: firstMode,
  }
  const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
  return { value: { id, rev: created?._rev ?? '' }, action: 'created' as const, contentId: doc.publicId, state: null }
  })
}

// ── Patch ─────────────────────────────────────────────────────────────────────

/** Changes allowed fields of the draft. Returns the new revision. */
export async function patchEventDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: EventDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new EventError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new EventError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > EVENT_LIMITS.patchBytes) throw new EventError('too_large', 'Too much at once.')
  // Field allowlist before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const ok =
      path === 'startDate' ||
      path === 'endDate' ||
      path === 'registrationUrl' ||
      path === 'place' ||
      path === 'categories' ||
      path === 'hostPeople' ||
      isChoiceField(path) ||
      (field in EVENT_TEXT_FIELDS && !!locale && rest.length === 0)
    if (!ok) throw new EventError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  // Independent reads + the single-project guard at the same time (awaited again before the write).
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, EventSite, void]>([
    readPair(client, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (archivedAtOf(published) || archivedAtOf(draft)) throw new EventError('archived', 'Restore this event to edit it.')
  if (draft!._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const locales = new Set(site.locales)
  // ADR-038 D6 — capabilities, enforced here (the editor only hides). Keeping a
  // value the event already has is always allowed; nothing stored is touched.
  const caps = await readEventCapabilities(client, grant.projectSlug)
  for (const [path, value] of Object.entries(input.set)) {
    const field = path.split('.')[0]
    if (field === 'attendanceMode') {
      if (typeof value === 'string' && !attendanceModeAllowed(caps, value, typeof draft.attendanceMode === 'string' ? draft.attendanceMode : null)) {
        throw new EventError('invalid_value', 'This way of attending is not available on this site.')
      }
      continue
    }
    if (field === 'place') {
      const token = value === null ? '' : value
      if (typeof token === 'string' && !placeTokenAllowed(caps, token, placeTokenOf(draft.place))) {
        throw new EventError('invalid_value', 'This place is not available on this site.')
      }
      continue
    }
    if (!eventFieldAllowed(caps, field)) throw new EventError('invalid_field', `Field "${path}" is not available on this site.`)
  }

  // ADR-043: hosts from People also need the People module and people.person.read (the capability check above covers `hosts`).
  if ('hostPeople' in input.set) assertModuleAction(ctx, projectId, PEOPLE_READ_PERMISSION)

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(input.set)) {
    if (path === 'hostPeople') {
      if (value === null || (Array.isArray(value) && value.length === 0)) {
        unset.push('hostPeople')
        continue
      }
      try {
        set.hostPeople = await personRefs(grant.projectSlug, value, { max: MAX_EVENT_HOST_PEOPLE, stored: draft.hostPeople }, { client })
      } catch (error) {
        if (error instanceof PersonError && error.code === 'failed') throw new EventError('failed', 'Could not save.')
        if (error instanceof PersonError) throw new EventError('invalid_value', 'Unknown person.')
        throw error
      }
      continue
    }
    if (path === 'startDate') {
      set.startDate = parseEventDate(value)
      continue
    }
    if (path === 'endDate') {
      if (value === null || value === '') unset.push('endDate')
      else set.endDate = parseEventDate(value)
      continue
    }
    if (path === 'registrationUrl') {
      const url = cleanRegistrationUrl(value)
      if (url) set.registrationUrl = url
      else unset.push('registrationUrl')
      continue
    }
    if (isChoiceField(path)) {
      const allowed = EVENT_CHOICE_FIELDS[path] as readonly string[]
      if (typeof value !== 'string' || !allowed.includes(value)) throw new EventError('invalid_value', `"${path}" is not an allowed value.`)
      set[path] = value
      continue
    }
    if (path === 'categories') {
      if (!Array.isArray(value) || value.length > MAX_EVENT_CATEGORIES || !value.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 64)) {
        throw new EventError('invalid_value', 'Unknown category.')
      }
      const keys = Array.from(new Set(value as string[]))
      // Only categories this site offers; one the event already carries may stay (e.g. its category was since removed).
      const stored = new Set(categoryKeysOfDoc(draft))
      const offered = new Set((await readCategoryOptions(client, grant.projectSlug)).map((o) => o.value))
      if (!keys.every((k) => offered.has(k) || stored.has(k))) throw new EventError('invalid_value', 'Unknown category.')
      if (keys.length) set.categories = keys
      else unset.push('categories')
      continue
    }
    if (path === 'place') {
      if (value === '' || value === null) {
        unset.push('place')
        continue
      }
      if (typeof value !== 'string' || !PLACE_TOKEN.test(value)) throw new EventError('invalid_value', 'Unknown place.')
      // Only a location of THIS site, or a saved venue of THIS project.
      const options = await readPlaceOptions(client, grant.projectSlug, site.defaultLocale)
      const [kind, ref] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
      if (kind === 'location') {
        if (!options.locations.some((l) => l.key === ref)) throw new EventError('invalid_value', 'Unknown place.')
        set.place = { kind: 'location', locationKey: ref }
      } else {
        if (!options.venues.some((v) => v.id === ref)) throw new EventError('invalid_value', 'Unknown place.')
        set.place = { kind: 'venue', venue: { _type: 'reference', _ref: ref } }
      }
      continue
    }
    const [field, locale] = path.split('.')
    if (!locales.has(locale)) throw new EventError('invalid_field', `Language "${locale}" is not on this site.`)
    const spec = EVENT_TEXT_FIELDS[field]
    if (typeof value !== 'string' || value.length > spec.max) throw new EventError('invalid_value', `"${path}" is too long or not text.`)
    const t = spec.type === 'localizedString' ? value.trim().replace(/\s+/g, ' ') : value.trim()
    ensure[field] = { _type: spec.type }
    if (t) set[path] = t
    else unset.push(path)
  }

  const start = (set.startDate as string | undefined) ?? (typeof draft.startDate === 'string' ? draft.startDate : null)
  const end = unset.includes('endDate') ? null : ((set.endDate as string | undefined) ?? (typeof draft.endDate === 'string' ? draft.endDate : null))
  if (start && end && Date.parse(end) < Date.parse(start)) throw new EventError('bad_dates', 'The end is before the start.')

  const result = (await commit(client, grant.projectSlug, () => {
    let p = client.patch(`drafts.${input.id}`).ifRevisionId(input.rev)
    if (Object.keys(ensure).length) p = p.setIfMissing(ensure)
    if (Object.keys(set).length) p = p.set(set)
    if (unset.length) p = p.unset(unset)
    return p.commit(DRAFT_SAVE)
  }, guard)) as { _rev?: string } | undefined
  return { rev: result?._rev ?? '' }
}

/** Sets the cover from one of this project's Media Library photos, or removes it. Returns the new revision. */
export async function setEventCover(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; assetId?: string; remove?: true },
  deps: EventDeps = {}
): Promise<{ rev: string; cover: EventCover | null }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new EventError('conflict', 'Missing revision.')
  const remove = input.remove === true
  if (!remove && (typeof input.assetId !== 'string' || !ASSET_ID.test(input.assetId))) throw new EventError('not_found', 'Unknown image.')

  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (archivedAtOf(published) || archivedAtOf(draft)) throw new EventError('archived', 'Restore this event to edit it.')
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')

  if (remove) {
    const r = (await commit(client, grant.projectSlug, () => client.patch(`drafts.${input.id}`).ifRevisionId(input.rev).unset(['heroImage']).commit(DRAFT_SAVE))) as { _rev?: string } | undefined
    return { rev: r?._rev ?? '', cover: null }
  }

  // Only a Media Library photo of THIS project (a foreign or missing id reads as not_found).
  const asset = await client.fetch<{ ref?: string | null; url?: string | null; altText?: unknown; hotspot?: Record<string, unknown> | null; crop?: Record<string, unknown> | null } | null>(
    `*[_type == "mediaAsset" && _id == $assetId && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ "ref": image.asset._ref, "url": image.asset->url, altText, "hotspot": image.hotspot, "crop": image.crop }`,
    { assetId: input.assetId, projectSlug: grant.projectSlug }
  )
  if (!asset?.ref || !asset.ref.startsWith('image-')) throw new EventError('not_found', 'Unknown image.')
  const alt = localized(asset.altText)
  const heroImage = {
    _type: 'localizedImage',
    asset: { _type: 'reference', _ref: asset.ref },
    ...(asset.hotspot && { hotspot: { ...asset.hotspot, _type: 'sanity.imageHotspot' } }),
    ...(asset.crop && { crop: { ...asset.crop, _type: 'sanity.imageCrop' } }),
    ...(Object.keys(alt).length && { alt: { _type: 'localizedString', ...alt } }),
  }
  const r = (await commit(client, grant.projectSlug, () => client.patch(`drafts.${input.id}`).ifRevisionId(input.rev).set({ heroImage }).commit(DRAFT_SAVE))) as { _rev?: string } | undefined
  return {
    rev: r?._rev ?? '',
    cover: { assetId: input.assetId!, url: asset.url ?? '', thumbUrl: coverThumbUrl(asset.url, asset.hotspot as { x?: number; y?: number } | null, 480), alt, focal: focalOf(asset.hotspot) },
  }
}

/**
 * Moves the cover's focal point — the part of the photo the website keeps in
 * view when it crops the cover. Stored on THIS event's cover only
 * (heroImage.hotspot): it is never written back to the Media Library (Tom,
 * 2026-10-22 — a point chosen where a photo is used belongs to that use), so
 * one event can't move the crop of every post, gallery or item using the photo.
 */
export async function setEventCoverFocal(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; focal: unknown },
  deps: EventDeps = {}
): Promise<{ rev: string; cover: EventCover | null }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new EventError('conflict', 'Missing revision.')
  const focal = parseEventFocal(input.focal)

  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (archivedAtOf(published) || archivedAtOf(draft)) throw new EventError('archived', 'Restore this event to edit it.')
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const hero = draft.heroImage as { asset?: { _ref?: unknown }; hotspot?: { width?: unknown; height?: unknown } } | undefined
  if (typeof hero?.asset?._ref !== 'string' || !hero.asset._ref.startsWith('image-')) throw new EventError('not_found', 'This event has no photo.')

  const hotspot = {
    _type: 'sanity.imageHotspot',
    x: focal.x,
    y: focal.y,
    width: typeof hero.hotspot?.width === 'number' ? hero.hotspot.width : COVER_HOTSPOT_SIZE,
    height: typeof hero.hotspot?.height === 'number' ? hero.hotspot.height : COVER_HOTSPOT_SIZE,
  }
  const r = (await commit(client, grant.projectSlug, () => client.patch(`drafts.${input.id}`).ifRevisionId(input.rev).set({ 'heroImage.hotspot': hotspot }).commit(DRAFT_SAVE))) as { _rev?: string } | undefined
  const cover = await readCover(client, grant.projectSlug, { ...(draft.heroImage as object), hotspot })
  return { rev: r?._rev ?? '', cover }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

/**
 * How a publish sets the event's dates (ADR-032):
 *   now      — online at once (a live event keeps its own go-live date)
 *   schedule — "Publish on…": a published document that the website shows once
 *              the date has passed (no job: the public rule compares with now())
 *   keep     — an update of what is online/scheduled keeps its date; a new
 *              event or an unpublished one with nothing else chosen = now
 */
export type EventPublishMode = 'now' | 'schedule' | 'keep'

/**
 * Publishes `drafts.<id>` in one revision-guarded transaction. Needs a title in
 * the site's main language and a start date. Every language with a title gets
 * a web address (slug) when it has none — unique among this site's events;
 * existing addresses never change. The status follows the dates, except an
 * event Abluo set to "live".
 *
 * Lifecycle (ADR-032): the draft never carries publishedAt / expiresAt /
 * archivedAt into the published version — they are set here from the published
 * version and the chosen `mode`, `publishAt` ("Publish on") and `unpublishAt`
 * ("Unpublish on"; null removes it, left out keeps a future one). Archived
 * events cannot be published (`archived`): restore first. Publishing an
 * unpublished event puts it back online.
 */
export async function publishEventDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; mode?: EventPublishMode; publishAt?: string; unpublishAt?: string | null },
  deps: EventDeps = {}
): Promise<{ id: string; publishedAt: string | null; unpublishOn: string | null }> {
  return audited({ ctx, projectId, contentType: 'event', contentId: isEventId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit }, async (transactionId) => {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new EventError('conflict', 'Missing revision.')
  const now = (deps.now ?? (() => new Date()))()
  const mode = input.mode ?? 'keep'
  if (mode !== 'now' && mode !== 'schedule' && mode !== 'keep') throw new EventError('invalid_value', 'Unknown publish mode.')
  const scheduledAt = mode === 'schedule' ? parseEventPublishAt(input.publishAt, now) : null
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  if (archivedAtOf(published) || archivedAtOf(draft)) throw new EventError('archived', 'Restore this event before publishing.')
  const site = await readSite(client, grant.projectSlug)
  const titles = localized(draft.title)
  if (!titles[site.defaultLocale]) throw new EventError('missing_title', 'The event needs a title.')
  if (typeof draft.startDate !== 'string' || !draft.startDate) throw new EventError('missing_date', 'The event needs a start date.')

  // Dates (ADR-032): from the PUBLISHED version and the chosen mode — never from the draft.
  const current = published ? eventLifecycleOf(published, false, now) : null
  const live = current?.status === 'published'
  // A live event is never moved into the future (that would take it offline).
  if (live && mode === 'schedule') throw new EventError('invalid_value', 'This event is already online.')
  const keepDate = Boolean(published) && (mode === 'keep' || (mode === 'now' && live))
  const publishedAt: string | null = keepDate ? publishedAtOf(published) : (scheduledAt ?? now).toISOString()
  let expiresAt: string | null = null
  if (input.unpublishAt === undefined) {
    // A future unpublish date survives an update; a passed one is dropped (publishing an unpublished event puts it back).
    const kept = current && (current.status === 'published' || current.status === 'scheduled') ? current.unpublishOn : null
    expiresAt = kept && (!publishedAt || Date.parse(kept) > Date.parse(publishedAt)) ? kept : null
  } else if (input.unpublishAt !== null) {
    expiresAt = parseEventUnpublishAt(input.unpublishAt, now, publishedAt)
  }

  const doc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
  doc._id = input.id
  doc._type = 'event'
  doc.projectSlug = grant.projectSlug
  doc.status = eventTiming(draft, now)
  if (publishedAt) doc.publishedAt = publishedAt
  if (expiresAt) doc.expiresAt = expiresAt

  // Web addresses for languages that have a title but no address yet.
  const slug = { ...((draft.slug as Record<string, unknown> | undefined) ?? {}) } as Record<string, unknown>
  const missing = site.locales.filter((l) => titles[l] && !(slug[l] as { current?: unknown } | undefined)?.current)
  if (missing.length) {
    const rows = await client.fetch<Array<{ _id: string; slug?: Record<string, { current?: unknown }> | null }> | null>(
      `*[_type == "event" && projectSlug == $projectSlug]{ _id, slug }`,
      { projectSlug: grant.projectSlug },
      { perspective: 'raw' }
    )
    for (const locale of missing) {
      const taken = new Set<string>()
      for (const row of rows ?? []) {
        if (row._id === input.id || row._id === `drafts.${input.id}`) continue
        const s = row.slug?.[locale]?.current
        if (typeof s === 'string' && s) taken.add(s)
      }
      slug[locale] = { _type: 'slug', current: uniqueSlug(slugFromTitle(titles[locale]) || 'event', taken) }
    }
    slug._type = 'localizedSlug'
    doc.slug = slug
  }

  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction().patch(`drafts.${input.id}`, { ifRevisionID: input.rev, unset: ['_publishGuard'] })
    if (published?._rev) {
      tx = tx.patch(input.id, { ifRevisionID: published._rev, unset: ['_publishGuard'] })
      tx = tx.createOrReplace(doc as { _id: string; _type: string })
    } else {
      tx = tx.create(doc as { _id: string; _type: string })
    }
    return tx.delete(`drafts.${input.id}`).commit({ transactionId })
  })
  // ADR-038 C6a — the schedule follows the published dates (Sanity first, then
  // Supabase; a failed write falls back to the Sanity dates, never stale ones).
  const sync = deps.syncSchedule === undefined ? syncEventSchedule : deps.syncSchedule
  if (sync) {
    const venueRef = (doc.place as { kind?: unknown; venue?: { _ref?: unknown } } | undefined)?.kind === 'venue' ? (doc.place as { venue?: { _ref?: unknown } }).venue?._ref : null
    const venue = typeof venueRef === 'string'
      ? await client.fetch<{ publicId?: string | null; timeZone?: string | null } | null>(
          `*[_type == "eventVenue" && _id == $id && projectSlug == $projectSlug][0]{ publicId, timeZone }`,
          { id: venueRef, projectSlug: grant.projectSlug }
        ).catch(() => null)
      : null
    const facts = factsOfPublishedEvent(doc, { siteTimeZone: site.timeZone, venue })
    if (facts) await sync(projectId, facts, ctx.userId ?? null)
  }
  const state = publishedSnapshotOf(doc)
  return {
    value: { id: input.id, publishedAt, unpublishOn: expiresAt },
    action: lifecycleAction(publishedSnapshotOf(published), state, 'optional', now),
    contentId: eventContentId(doc, input.id),
    state,
  }
  })
}

/**
 * Throws away unpublished changes. For a never-published event that removes it
 * entirely, so it also needs events.event.delete.
 */
export async function discardEventDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: EventDeps = {}
): Promise<{ deleted: boolean }> {
  return audited({ ctx, projectId, contentType: 'event', contentId: isEventId(input?.id) ? input.id : null, intended: 'deleted', writer: deps.audit }, async (transactionId) => {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  // An archived event is put away or deleted for good (Restore · Delete permanently), never "discarded".
  if (archivedAtOf(published)) throw new EventError('archived', 'This event is archived.')
  if (!published) grantFor(ctx, projectId, EVENT_DELETE_PERMISSION)
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit({ transactionId })
  )
  // Discarding the draft of a published event is not a lifecycle change;
  // discarding a never-published one deletes the event.
  return { value: { deleted: !published }, action: published ? null : ('deleted' as const), contentId: eventContentId(draft, input.id), state: null, detail: { draftOnly: true } }
  })
}

// ── Unpublish · Archive · Restore · Delete permanently (ADR-032 Phase 3) ──────

const LIFECYCLE_CODE: Record<lifecycle.LifecycleErrorCode, EventErrorCode> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_value: 'invalid_value',
  archived: 'archived',
  archive_first: 'archive_first',
  in_use: 'in_use',
  unpublished_dependencies: 'failed',
  failed: 'failed',
}

/** EVERY document of the project that references the event in any version (a page's events list, a post's related event…), except its own versions. */
export const EVENT_DELETE_REFERRERS = /* groq */ `*[projectSlug == $projectSlug && references($id) && !(_id in [$id, $draftId]) && !(_id in path("versions.**"))]{ _id, _type, "label": coalesce(title, internalName, name) }`

const USAGE_KIND: Record<string, EventUsage['kind']> = { page: 'page', homePage: 'page', post: 'post', course: 'course', event: 'event' }

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  const pick = v.en ?? Object.entries(v).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x)?.[1]
  return typeof pick === 'string' ? pick : ''
}

/** The lifecycle descriptor of events: `optional` rule (no dates = live, no data migration); delete needs events.event.delete (owner / editor by default). */
export function eventLifecycle(): lifecycle.LifecycleDescriptor {
  return {
    type: 'event',
    rule: 'optional',
    permissions: {
      // Edit, publish, schedule, unpublish, archive, restore.
      write: EVENT_WRITE_PERMISSION,
      delete: EVENT_DELETE_PERMISSION,
      deletePublished: EVENT_DELETE_PERMISSION,
    },
    isId: isEventId,
    fail: (code, message) => new EventError(LIFECYCLE_CODE[code], message),
    refuseArchiveWhileReferenced: false,
    deleteReferrers: async (client, id, projectSlug) => {
      type Row = { _id: string; _type?: string; label?: unknown }
      const rows = await client.fetch<Row[] | null>(EVENT_DELETE_REFERRERS, { id, draftId: `drafts.${id}`, projectSlug }, { perspective: 'raw' })
      const seen = new Map<string, lifecycle.Referrer>()
      for (const r of rows ?? []) {
        const rid = r._id.replace(/^drafts\./, '')
        if (!seen.has(rid)) seen.set(rid, { id: rid, type: typeof r._type === 'string' ? r._type : 'unknown', label: textOf(r.label) || 'Untitled' })
      }
      return [...seen.values()]
    },
    label: (doc) => textOf(doc.title) || 'Event',
  }
}

export const EVENT_LIFECYCLE_OPS = ['archive', 'restore', 'unpublish', 'publishAgain', 'deletePermanently'] as const
export type EventLifecycleOp = (typeof EVENT_LIFECYCLE_OPS)[number]

/**
 * Unpublish / Publish again / Archive / Restore (events.event.write) and
 * Delete permanently (events.event.delete) through the lifecycle service, which
 * checks permission and ownership, guards revisions and writes the Activity
 * row. Past events are never archived by anything here (only by a person).
 *
 *   unpublish     published or scheduled → Unpublished: the unpublish date is
 *                 now (D2: never Sanity's Unpublish). The event, its slug and
 *                 its schedule stay; only the website stops showing it.
 *   publishAgain  Unpublished → online now (the unpublish date is removed; a
 *                 go-live date still in the future moves to now).
 *   archive       published / scheduled / unpublished → Archived (both versions).
 *   restore       Archived → Unpublished — never republished by itself.
 *   deletePermanently  Archived only (`archive_first` otherwise), and refused
 *                 while a page, post or course still names the event (`in_use`).
 *
 * Returns the DRAFT's new revision when the draft was touched too (archive /
 * restore), so an open editor does not save against a stale one.
 */
export async function runEventLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: EventLifecycleOp },
  deps: EventDeps = {}
): Promise<{ rev: string | null }> {
  if (!(EVENT_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new EventError('invalid_value', 'Unknown action.')
  // Gate before any read (the service re-checks).
  const grant = grantFor(ctx, projectId, input.op === 'deletePermanently' ? EVENT_DELETE_PERMISSION : EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  const now = (deps.now ?? (() => new Date()))()
  if (!isEventId(input.id)) notFound()
  const d = eventLifecycle()
  const { published } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
  const args = { id: input.id, rev: str(published?._rev) }
  const current = published ? eventLifecycleOf(published, false, now) : null
  try {
    switch (input.op) {
      case 'archive': {
        const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'restore': {
        const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'unpublish': {
        if (!published) throw new EventError('invalid_value', 'This event is not published.')
        if (current?.status === 'archived') throw new EventError('archived', 'Restore this event first.')
        if (current?.status === 'unpublished') throw new EventError('invalid_value', 'This event is already unpublished.')
        await lifecycle.unpublishNow(d, ctx, projectId, args, sdeps)
        return { rev: null }
      }
      case 'publishAgain': {
        if (!published) throw new EventError('invalid_value', 'This event is not published.')
        if (current?.status === 'archived') throw new EventError('archived', 'Restore this event first.')
        if (current?.status !== 'unpublished') throw new EventError('invalid_value', 'This event is not unpublished.')
        const goLive = publishedAtOf(published)
        if (goLive && Date.parse(goLive) > now.getTime()) {
          // Its go-live date is still ahead: "Publish again" means online now, not "scheduled again".
          const r = await lifecycle.setDates(d, ctx, projectId, { ...args, publishedAt: 'now', expiresAt: null }, sdeps)
          return { rev: r.draftRev }
        }
        await lifecycle.backOnline(d, ctx, projectId, args, sdeps)
        return { rev: null }
      }
      case 'deletePermanently':
        await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
        return { rev: null }
    }
  } catch (error) {
    const referrers = (error as { referrers?: lifecycle.Referrer[] } | null)?.referrers
    if (error instanceof EventError && error.code === 'in_use' && referrers?.length) {
      const usedIn: EventUsage[] = referrers.map((r) => ({ kind: USAGE_KIND[r.type] ?? 'other', id: r.id, title: r.label }))
      throw new EventError('in_use', error.message, { usedIn })
    }
    throw error
  }
}

/**
 * "Publish on" / "Unpublish on" of an event that is already published (the
 * editor's Publishing block). `unpublishAt`: an ISO moment in the future, or
 * null to remove it; left out = unchanged. `publishAt`: a new go-live date, or
 * 'now' — only for a SCHEDULED event (moving a live one into the future would
 * take it offline). Never archives: when the unpublish date passes the event
 * is Unpublished, nothing else. Refused for archived and for unpublished events
 * (a future date would quietly put them back online). Both versions are
 * written, so the draft does not drift. Write permission; Activity via the
 * lifecycle service.
 */
export async function setEventDates(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; publishAt?: string; unpublishAt?: string | null },
  deps: EventDeps = {}
): Promise<{ publishedAt: string | null; unpublishOn: string | null; rev: string | null }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const now = (deps.now ?? (() => new Date()))()
  if (!isEventId(input?.id)) notFound()
  if (input.publishAt === undefined && input.unpublishAt === undefined) throw new EventError('invalid_value', 'Nothing to change.')
  const { published } = await readPair(client, input.id, grant.projectSlug)
  if (!published) throw new EventError('invalid_value', 'Publish this event first.')
  const current = eventLifecycleOf(published, false, now)
  if (current.status === 'archived') throw new EventError('archived', 'Restore this event first.')
  if (input.publishAt !== undefined && current.status !== 'scheduled') throw new EventError('invalid_value', 'This event is not waiting for a date.')
  if (input.unpublishAt !== undefined && current.status === 'unpublished') throw new EventError('invalid_value', 'This event is already unpublished.')

  const publishAt = input.publishAt === undefined ? undefined : input.publishAt === 'now' ? 'now' : parseEventPublishAt(input.publishAt, now).toISOString()
  const goLive = publishAt === undefined ? publishedAtOf(published) : publishAt === 'now' ? now.toISOString() : publishAt
  const unpublishAt = input.unpublishAt === undefined ? undefined : input.unpublishAt === null ? null : parseEventUnpublishAt(input.unpublishAt, now, goLive)
  const d = eventLifecycle()
  const sdeps = { client, now: deps.now, audit: deps.audit }
  const rev = str(published._rev)
  const r =
    publishAt !== undefined
      ? await lifecycle.setDates(d, ctx, projectId, { id: input.id, rev, publishedAt: publishAt, expiresAt: unpublishAt === undefined ? current.unpublishOn : unpublishAt }, sdeps)
      : await lifecycle.setEndDate(d, ctx, projectId, { id: input.id, rev, expiresAt: unpublishAt ?? null }, sdeps)
  return { publishedAt: isoOf(r.doc.publishedAt), unpublishOn: isoOf(r.doc.expiresAt), rev: r.draftRev }
}

// ── Activity ──────────────────────────────────────────────────────────────────

/** The event's Activity (ADR-032 D9). Read permission; the event must be this project's. Rows are keyed by the publicId or the document id. */
export async function getEventActivity(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: EventDeps = {}): Promise<ActivityItem[]> {
  const grant = grantFor(ctx, projectId, EVENT_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  const contentIds = [...new Set([eventContentId(published ?? draft, input.id), input.id])]
  return (deps.read ?? readContentActivity)({ projectId, contentType: 'event', contentIds })
}
