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
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (EventErrorCode).
 */
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { coverThumbUrl } from '@/lib/api/post-drafts'
import { slugFromTitle, uniqueSlug } from '@/lib/api/post-publish'

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
  | 'failed'

export class EventError extends Error {
  constructor(
    readonly code: EventErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EventError'
  }
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type EventDeps = { client?: Client; now?: () => Date; uuid?: () => string }

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

async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>): Promise<unknown> {
  await assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)
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

export type EventSite = { defaultLocale: string; locales: string[] }

async function readSite(client: Client, projectSlug: string): Promise<EventSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new EventError('failed', 'Site languages are not configured.')
  return { defaultLocale, locales: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

/** The site's languages for an event that doesn't exist yet. Same gate as creating one. */
export async function getEventSite(ctx: TenantAuthorizationContext, projectId: string, deps: EventDeps = {}): Promise<EventSite> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  return readSite(deps.client ?? sanityWriteClient, grant.projectSlug)
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

/** "upcoming" / "past" from the dates; an event Abluo set to "live" stays live. */
export function eventTiming(doc: Record<string, unknown>, now: Date): 'upcoming' | 'live' | 'past' {
  if (doc.status === 'live') return 'live'
  const start = typeof doc.startDate === 'string' ? Date.parse(doc.startDate) : NaN
  const end = typeof doc.endDate === 'string' ? Date.parse(doc.endDate) : NaN
  const last = Number.isNaN(end) ? start : end
  if (Number.isNaN(last)) return 'upcoming'
  return last >= now.getTime() ? 'upcoming' : 'past'
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
  location: string
  startDate: string | null
  endDate: string | null
  timing: 'upcoming' | 'live' | 'past'
  coverThumb: string | null
  hasDraft: boolean
  isPublished: boolean
  updatedAt: string
}

const LIST_QUERY = /* groq */ `*[_type == "event" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _updatedAt, title, location, startDate, endDate, status,
    "coverUrl": heroImage.asset->url, "coverHotspot": heroImage.hotspot
  }`

type ListRow = {
  _id: string
  _updatedAt?: string
  title?: unknown
  location?: unknown
  startDate?: string | null
  endDate?: string | null
  status?: string | null
  coverUrl?: string | null
  coverHotspot?: { x?: number; y?: number } | null
}

/** This project's events (draft shown over published), upcoming first by date, then past newest first. Read permission. */
export async function listEvents(ctx: TenantAuthorizationContext, projectId: string, deps: EventDeps = {}): Promise<EventListItem[]> {
  const grant = grantFor(ctx, projectId, EVENT_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const now = (deps.now ?? (() => new Date()))()
  const rows = (await client.fetch<ListRow[] | null>(LIST_QUERY, { projectSlug: grant.projectSlug }, { perspective: 'raw' })) ?? []

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
      location: pick(row.location, site.defaultLocale),
      startDate: typeof row.startDate === 'string' ? row.startDate : null,
      endDate: typeof row.endDate === 'string' ? row.endDate : null,
      timing: eventTiming(row, now),
      coverThumb: coverThumbUrl(row.coverUrl, row.coverHotspot),
      hasDraft: Boolean(draft),
      isPublished: Boolean(published),
      updatedAt: row._updatedAt ?? '',
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

export type EventCover = { assetId: string; url: string; thumbUrl: string | null; alt: Record<string, string> }

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
}

function snapshotOf(id: string, doc: Doc, draft: Doc | undefined, published: Doc | undefined, site: EventSite, cover: EventCover | null, now: Date): EventSnapshot {
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
    hasStudioContent: ['fullDescription', 'schedule', 'hosts', 'priceOptions', 'gallery'].some((f) => nonEmpty(doc[f])),
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
  return {
    assetId: row?._id ?? ref,
    url,
    thumbUrl: coverThumbUrl(url, row?.hotspot ?? (heroImage as { hotspot?: { x?: number; y?: number } }).hotspot ?? null, 480),
    alt: Object.keys(own).length ? own : localized(row?.altText),
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
  const cover = await readCover(client, grant.projectSlug, doc.heroImage)
  return snapshotOf(id, doc, draft, published, site, cover, (deps.now ?? (() => new Date()))())
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
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'event'
  copy.projectSlug = grant.projectSlug
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string })) as { _rev?: string } | undefined
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
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const raw = input?.title ?? ''
  if (typeof raw !== 'string' || raw.length > EVENT_LIMITS.title) throw new EventError('invalid_value', 'The title is too long.')
  const title = raw.trim().replace(/\s+/g, ' ')
  if (!title) throw new EventError('missing_title', 'Give the event a name.')
  const startDate = parseEventDate(input?.startDate)
  const site = await readSite(client, grant.projectSlug)
  const count = await client.fetch<number | null>(`count(*[_type == "event" && projectSlug == $projectSlug])`, { projectSlug: grant.projectSlug }, { perspective: 'raw' })
  if ((count ?? 0) >= EVENT_LIMITS.events) throw new EventError('too_large', 'This site has too many events.')
  const id = (deps.uuid ?? randomUUID)()
  const doc = {
    _id: `drafts.${id}`,
    _type: 'event',
    projectSlug: grant.projectSlug,
    title: { _type: 'localizedString', [site.defaultLocale]: title },
    startDate,
    status: eventTiming({ startDate }, (deps.now ?? (() => new Date()))()),
  }
  const created = (await commit(client, grant.projectSlug, () => client.create(doc))) as { _rev?: string } | undefined
  return { id, rev: created?._rev ?? '' }
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
    const ok = path === 'startDate' || path === 'endDate' || path === 'registrationUrl' || (field in EVENT_TEXT_FIELDS && !!locale && rest.length === 0)
    if (!ok) throw new EventError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const { draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const site = await readSite(client, grant.projectSlug)
  const locales = new Set(site.locales)

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(input.set)) {
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
    return p.commit()
  })) as { _rev?: string } | undefined
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

  const { draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')

  if (remove) {
    const r = (await commit(client, grant.projectSlug, () => client.patch(`drafts.${input.id}`).ifRevisionId(input.rev).unset(['heroImage']).commit())) as { _rev?: string } | undefined
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
  const r = (await commit(client, grant.projectSlug, () => client.patch(`drafts.${input.id}`).ifRevisionId(input.rev).set({ heroImage }).commit())) as { _rev?: string } | undefined
  return {
    rev: r?._rev ?? '',
    cover: { assetId: input.assetId!, url: asset.url ?? '', thumbUrl: coverThumbUrl(asset.url, asset.hotspot as { x?: number; y?: number } | null, 480), alt },
  }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

/**
 * Publishes `drafts.<id>` in one revision-guarded transaction. Needs a title in
 * the site's main language and a start date. Every language with a title gets
 * a web address (slug) when it has none — unique among this site's events;
 * existing addresses never change. The status follows the dates, except an
 * event Abluo set to "live".
 */
export async function publishEventDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: EventDeps = {}
): Promise<{ id: string }> {
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new EventError('conflict', 'Missing revision.')
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const site = await readSite(client, grant.projectSlug)
  const titles = localized(draft.title)
  if (!titles[site.defaultLocale]) throw new EventError('missing_title', 'The event needs a title.')
  if (typeof draft.startDate !== 'string' || !draft.startDate) throw new EventError('missing_date', 'The event needs a start date.')

  const doc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k)) doc[k] = v
  doc._id = input.id
  doc._type = 'event'
  doc.projectSlug = grant.projectSlug
  doc.status = eventTiming(draft, (deps.now ?? (() => new Date()))())

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
    return tx.delete(`drafts.${input.id}`).commit()
  })
  return { id: input.id }
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
  const grant = grantFor(ctx, projectId, EVENT_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isEventId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) grantFor(ctx, projectId, EVENT_DELETE_PERMISSION)
  if (draft._rev !== input.rev) throw new EventError('conflict', 'This event was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit()
  )
  return { deleted: !published }
}
