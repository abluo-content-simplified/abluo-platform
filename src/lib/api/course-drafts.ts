/**
 * Client dashboard — Courses (ADR-045, timetable build spec §3–4). Mirrors
 * persons.ts, trimmed to what a course is: a title, a short description and a
 * colour. The classes (weekly series, teachers, exceptions) are scheduling
 * data, written by `course-guarded.server.ts` in the scheduling wave.
 *
 * Edits go to a DRAFT (`drafts.<courseId>`); only "Publish" changes the live
 * document. Same enforcement as persons / faq-sets / the lifecycle service:
 *   1. `assertModuleAction(ctx, projectId, courses.course.*)` before any I/O;
 *      identity (`_id`, `_type`, `projectSlug`, `publicId`) comes from the
 *      GRANT and the stored document, never from input.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `course`s of the grant's project — anything else
 *      is "not_found", so ids cannot be probed.
 *   3. Patch allow-list (`title.<loc>`, `shortDescription.<loc>`, `slug.<loc>`,
 *      `color`, `image`); languages must be the site's (or already stored in
 *      the draft). A page address (slug) is normalised and must be free among
 *      the site's courses (current AND retired addresses) — `slug_taken`.
 *   3b. Publish fills a missing address from the title for every language that
 *      has one (the event / post convention) and keeps a changed published
 *      address as a redirect (Publicly Routable Content Pattern).
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards → "conflict".
 *   5. Opaque error codes (CourseErrorCode).
 *   6. Archive / restore / delete go through the one lifecycle service.
 */
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import { readContentActivity, type ActivityItem } from '@/lib/lifecycle/activity'
import * as lifecycle from '@/lib/lifecycle/service'
import { lifecycleAction, snapshotOf } from '@/lib/lifecycle/transition'
import { deriveStatus } from '@/lib/lifecycle/status'
import { readPlacementInfo } from '@/lib/api/course-placement'
import { readCoursePaletteSource, type CoursePaletteSource } from '@/lib/api/course-palette'
import { coursePlacement, type PlacementInfo } from '@/lib/modules/courses/placement'
import { DEFAULT_COURSE_COLOR, isCourseColor, normalizeCourseColor, type CourseColor } from '@/lib/modules/courses/model'
import { COURSE_SLUG_PATTERN, courseSlugFrom, uniqueCourseSlug } from '@/lib/modules/courses/slug'
import { cleanCourseSegments } from '@/lib/modules/courses/website'
import {
  COURSE_DELETE_PERMISSION,
  COURSE_READ_PERMISSION,
  COURSE_WRITE_PERMISSION,
  CourseError,
  courseLifecycle,
  isCourseId,
  noSchedule,
  UUID_RE,
  type CourseErrorCode,
  type CourseUsage,
  type HasScheduleFn,
} from '@/lib/api/course-lifecycle'

export { COURSE_DELETE_PERMISSION, COURSE_READ_PERMISSION, COURSE_WRITE_PERMISSION, CourseError, isCourseId }
export type { CourseErrorCode, CourseUsage }

export const COURSE_LIMITS = {
  title: 120,
  shortDescription: 600,
  courses: 500,
  patchBytes: 50_000,
} as const

/**
 * `scheduled` = published with a go-live date in the future (not on the website yet). `changes` = live + unpublished edits.
 * `unpublished` = published once, taken off the website (its unpublish date has passed); "Publish again" puts it back.
 */
export type CourseState = 'draft' | 'scheduled' | 'published' | 'changes' | 'unpublished' | 'archived'

/** languages[0] = the default language. */
export interface CourseSite {
  defaultLocale: string
  languages: string[]
  /** The site's IANA time zone (dates are entered in it), or null. */
  timeZone: string | null
}

/** A person a class names (People publicId + display name). */
export interface CoursePersonRef {
  publicId: string
  name: string
}

/** One weekday of one class ("Mon 12:30 · MERO"). A class that meets on two weekdays gives two slots. */
export interface CourseClassSlot {
  seriesId: string
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
  /** 'HH:mm' (24-hour, the class's own zone = the site's). */
  startTime: string
  /** `location:<key>` / `venue:<id>`, '' = no place. */
  placeToken: string
  mode: 'inPerson' | 'online' | 'mixed'
}

/** A date of the course that differs from its class: the most important difference only. */
export type CourseExceptionKind = 'cancelled' | 'substitute' | 'timeChanged' | 'moved'
export interface CourseException {
  /** 'YYYY-MM-DD' (site zone). */
  date: string
  startTime: string
  kind: CourseExceptionKind
  /** The date's place (for `moved`). */
  placeToken: string
}

/** The course's next class that takes place (for the list's quick actions). */
export interface CourseNextClass {
  seriesId: string
  occurrenceId: string
  version: number
  /** 'YYYY-MM-DD' (site zone). */
  date: string
  startTime: string
  endTime: string | null
  /** UTC ISO instant. */
  startsAt: string
  /** Who teaches this date. */
  instructors: CoursePersonRef[]
  /** Who teaches the class normally. */
  seriesInstructors: CoursePersonRef[]
  substituted: boolean
  placeToken: string
  seriesPlaceToken: string
}

/** What scheduling knows about a course; null per course (or overall) = not available yet. */
export interface CourseScheduleSummary {
  /** Weekly classes (live series). */
  classes: number
  /** Teacher names (People), in the site's default language. */
  teachers: string[]
  /** ISO instant of the next class, or null. */
  nextClassAt: string | null
  /** Every weekday of every class, Monday first, then by time. */
  slots?: CourseClassSlot[]
  /** The classes' regular teachers (for the teacher filter). */
  teacherRefs?: CoursePersonRef[]
  /** Languages the classes are taught in. */
  languages?: string[]
  /** The terms the classes belong to (edition ids). */
  termIds?: string[]
  /** The course's last class date ('YYYY-MM-DD'); null when it has none or keeps going. */
  lastDate?: string | null
  /** At least one class repeats with no last date (no term end, no end date). */
  openEnded?: boolean
  /** Dates that differ from their class, from about a week ago to about two weeks ahead (the list narrows them down). */
  exceptions?: CourseException[]
  /** The next class that takes place. */
  next?: CourseNextClass | null
}

/** The site's places and terms for the list's filters and lines (from scheduling + Website Settings). */
export interface CourseScheduleOverview {
  places: Array<{ token: string; name: string; short: string | null }>
  /** Site-wide terms, earliest first. */
  terms: Array<{ id: string; label: string; startsOn: string; endsOn: string }>
}

/** Everything the Courses list needs beyond the courses themselves. */
export interface CourseListOverview extends CourseScheduleOverview {
  /** The design system's primary colours (the course palette is derived from them, palette.ts). */
  palette: CoursePaletteSource
  /** The Courses module's page segment per language; {} = no course pages on this site. */
  pageSegments: Record<string, string>
}

export interface CourseListItem {
  /** Sanity document id (base id). */
  id: string
  publicId: string
  /** Title in the site's default language (else the first one written). */
  title: string
  /** Short description in the default language (else the first one written). */
  shortDescription: string
  color: CourseColor
  state: CourseState
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  /** The published version's go-live date (ISO), null when it has none (live since before dates existed, or never published). */
  publishedAt: string | null
  /** The published version's future unpublish date (ISO), or null. */
  unpublishOn: string | null
  /** From scheduling; null while it is not available. */
  schedule: CourseScheduleSummary | null
  /** The course has an image (draft or published, whichever is newer). */
  hasImage: boolean
  /** The PUBLISHED course has a page address in the site's main language. */
  hasPageAddress: boolean
  /** Where it is on the website (its course page, else a timetable page) — only while it is online. */
  liveUrl: string | null
  updatedAt: string
  createdAt: string
  /** Lower-cased titles, descriptions and teachers (every language), for search. */
  searchText: string
  /** Site languages (beyond the default) that still have no title. */
  missingLanguages: string[]
}

export interface CourseSnapshot {
  id: string
  publicId: string
  /** The draft's revision ('' when there is no draft). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  /** The published version's go-live date (ISO), or null. */
  publishedAt: string | null
  /** The published version's future unpublish date (ISO), or null. */
  unpublishOn: string | null
  state: CourseState
  title: Record<string, string>
  shortDescription: Record<string, string>
  color: CourseColor
  /** The optional course image — a Media Library asset of this website (picked in the editor). */
  image: CourseImage | null
  /** The course page address per language (the last part of the URL); a missing one is made from the title on publish. */
  slug: Record<string, string>
  /** The Courses module's page segment per language (`courses` → /courses/<slug>); {} = no course pages on this site yet. */
  pageSegments: Record<string, string>
  /** The design system's primary colours: the editor's colour swatches are derived from them (palette.ts). */
  palette: CoursePaletteSource
  site: CourseSite
}

/** The course image as the editor shows it. `alt` is the asset's description per language. */
export interface CourseImage {
  assetId: string
  url: string | null
  alt: Record<string, string>
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type CourseDeps = {
  client?: Client
  now?: () => Date
  /** Where the site's timetables are (publish refuses a course nothing would show). Default: read from Sanity. */
  placement?: (projectSlug: string) => Promise<PlacementInfo>
  /** New course ids. */
  uuid?: () => string
  /** New publicIds. */
  publicUuid?: () => string
  audit?: ContentAuditWriter
  read?: typeof readContentActivity
  /** Does the course have classes? Delete refuses when it does. Default: no (TODO: scheduling store). */
  hasSchedule?: HasScheduleFn
  /** Classes / teachers / next class per course publicId. Default: not available. */
  scheduleSummary?: (projectId: string, publicIds: string[]) => Promise<Map<string, CourseScheduleSummary> | null>
  /** The site's places and terms (the list's filters). Default: none. */
  scheduleOverview?: (projectId: string) => Promise<CourseScheduleOverview | null>
  /** The design system's primary colours. Default: read from Sanity. */
  paletteSource?: (projectSlug: string) => Promise<CoursePaletteSource>
}

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields a draft never copies from the published version (no publication window). */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const RAW = { perspective: 'raw' } as const
const LOCALIZED_FIELDS = ['title', 'shortDescription'] as const
const LOCALIZED_TYPE: Record<(typeof LOCALIZED_FIELDS)[number], string> = { title: 'localizedString', shortDescription: 'localizedText' }

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new CourseError('not_found', 'Unknown course.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'course' && doc.projectSlug === projectSlug)
}

async function readPair(client: Client, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [Doc | undefined, Doc | undefined]
  if ((published && !ours(published, projectSlug)) || (draft && !ours(draft, projectSlug))) notFound()
  return { published, draft }
}

const singleProjectGuard = (client: Client, projectSlug: string) => assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)

async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>, guard?: Promise<void>): Promise<unknown> {
  await (guard ?? singleProjectGuard(client, projectSlug))
  try {
    return await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new CourseError('conflict', 'This course was changed elsewhere.')
    throw new CourseError('failed', 'Could not save.')
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const archivedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.archivedAt === 'string' && doc.archivedAt ? doc.archivedAt : null)
/** Current keys; legacy 'accent' / 'muted' read as c1 / c6 (no data migration). */
const colorOf = (v: unknown): CourseColor => normalizeCourseColor(v)
/** Media Library asset ids (document ids): letters, digits, dashes, underscores. */
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** `{ en: { current: 'yoga' } }` → `{ en: 'yoga' }`. */
function slugsOf(doc: Doc | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [loc, v] of Object.entries(objectOf(doc?.slug) ?? {})) {
    const cur = objectOf(v)?.current
    if (!loc.startsWith('_') && typeof cur === 'string' && cur) out[loc] = cur
  }
  return out
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function localized(value: unknown): Record<string, string> {
  const o = objectOf(value)
  if (!o) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

const firstOf = (map: Record<string, string>, defaultLocale: string): string => map[defaultLocale] ?? Object.values(map)[0] ?? ''

const publishedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.publishedAt === 'string' && doc.publishedAt ? doc.publishedAt : null)
const expiresAtOf = (doc: Doc | undefined): string | null => (typeof doc?.expiresAt === 'string' && doc.expiresAt ? doc.expiresAt : null)

/** ADR-032 status of the published version (publication window + archive marker; courses: no publish date = public). */
function windowStatus(published: Doc | undefined, now: Date) {
  return deriveStatus({ published: published ? { publishedAt: publishedAtOf(published), expiresAt: expiresAtOf(published), archivedAt: archivedAtOf(published) } : null, rule: 'optional' }, now)
}

/** The published course is waiting for a future go-live date (ADR-032 status 'scheduled'). */
function isScheduled(published: Doc | undefined, now: Date): boolean {
  return Boolean(published) && windowStatus(published, now).status === 'scheduled'
}

/** The published course is off the website: its unpublish date has passed (ADR-032 status 'unpublished'). */
function isUnpublished(published: Doc | undefined, now: Date): boolean {
  return Boolean(published) && !archivedAtOf(published) && windowStatus(published, now).status === 'unpublished'
}

/** A future unpublish date of the published version, else null. */
function unpublishOnOf(published: Doc | undefined, now: Date): string | null {
  if (!published) return null
  const s = windowStatus(published, now)
  return s.status === 'published' || s.status === 'scheduled' ? s.unpublishOn : null
}

function stateOf(published: Doc | undefined, draft: Doc | undefined, now: Date): CourseState {
  if (archivedAtOf(published ?? draft)) return 'archived'
  if (isScheduled(published, now)) return 'scheduled'
  if (isUnpublished(published, now)) return 'unpublished'
  if (published && draft) return 'changes'
  return published ? 'published' : 'draft'
}

async function readSite(client: Client, projectSlug: string): Promise<CourseSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null; timeZone?: string | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales, timeZone }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new CourseError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)], timeZone: typeof site?.timeZone === 'string' && site.timeZone ? site.timeZone : null }
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Exported so tests assert exactly what runs. Raw perspective: drafts and published. */
export const COURSE_LIST_QUERY = /* groq */ `*[_type == "course" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
      | order(_updatedAt desc)[0...${COURSE_LIMITS.courses * 2}]{
        _id, _createdAt, _updatedAt, publicId, title, shortDescription, color, archivedAt, publishedAt, expiresAt, slug, "hasImage": defined(image._ref)
      }`

type ListRow = Doc & { _createdAt?: string; _updatedAt?: string; hasImage?: boolean }

/** A read whose failure only leaves something out of the list (never the list itself). */
async function soft<T>(read: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!read) return fallback
  try {
    return await read()
  } catch {
    return fallback
  }
}

/** This project's courses, newest change first, and what the list shows around them. Read permission. */
export async function listCourses(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: CourseDeps = {}
): Promise<{ courses: CourseListItem[]; site: CourseSite; overview: CourseListOverview }> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const rows = await client.fetch<ListRow[] | null>(COURSE_LIST_QUERY, { projectSlug: grant.projectSlug }, RAW)
  const byId = new Map<string, { draft?: ListRow; published?: ListRow; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = String(row._id).startsWith('drafts.')
    const id = isDraft ? String(row._id).slice('drafts.'.length) : String(row._id)
    if (!isCourseId(id)) continue
    const entry = byId.get(id) ?? { createdAt: '' }
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  const publicIds = [...byId.values()].map((e) => str((e.draft ?? e.published)?.publicId)).filter((x) => UUID_RE.test(x))
  // Decoration: each read may fail on its own and only leaves its part out.
  const [summaries, scheduleOverview, placement, palette] = await Promise.all([
    soft(deps.scheduleSummary ? () => deps.scheduleSummary!(projectId, publicIds) : undefined, null),
    soft(deps.scheduleOverview ? () => deps.scheduleOverview!(projectId) : undefined, null),
    soft<PlacementInfo | null>(() => (deps.placement ? deps.placement(grant.projectSlug) : readPlacementInfo(client, grant.projectSlug, '')), null),
    soft<CoursePaletteSource>(() => (deps.paletteSource ?? ((slug: string) => readCoursePaletteSource(client, slug)))(grant.projectSlug), { light: null, dark: null }),
  ])
  const segments = placement?.courseSegments ?? {}
  const now = (deps.now ?? (() => new Date()))()
  const courses = [...byId].map(([id, e]): CourseListItem => {
    const row = (e.draft ?? e.published)!
    const base = (e.published ?? e.draft)!
    const titles = localized(row.title)
    const descriptions = localized(row.shortDescription)
    const publicId = str(row.publicId)
    const schedule = summaries?.get(publicId.toLowerCase()) ?? summaries?.get(publicId) ?? null
    const archivedAt = archivedAtOf(base)
    const state = stateOf(e.published, e.draft, now)
    const publishedSlugs = slugsOf(e.published)
    const online = state === 'published' || state === 'changes'
    const liveUrl = online && placement ? coursePlacement({ ...placement, courseSlugs: publishedSlugs }, id).url : null
    return {
      id,
      publicId,
      title: firstOf(titles, site.defaultLocale),
      shortDescription: firstOf(descriptions, site.defaultLocale),
      color: colorOf(row.color),
      state,
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt,
      publishedAt: publishedAtOf(e.published),
      unpublishOn: unpublishOnOf(e.published, now),
      schedule,
      hasImage: row.hasImage === true,
      hasPageAddress: Boolean(publishedSlugs[site.defaultLocale]),
      liveUrl,
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
      searchText: [...Object.values(titles), ...Object.values(descriptions), ...(schedule?.teachers ?? [])].join(' ').toLowerCase(),
      missingLanguages: site.languages.filter((l) => l !== site.defaultLocale && !titles[l]),
    }
  })
  return {
    courses,
    site,
    overview: { places: scheduleOverview?.places ?? [], terms: scheduleOverview?.terms ?? [], palette, pageSegments: segments },
  }
}

// ── Get ───────────────────────────────────────────────────────────────────────

/** The course as the editor shows it: the draft when there is one, else the published version. */
export async function getCourseForEdit(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: CourseDeps = {}): Promise<CourseSnapshot> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isCourseId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  return {
    id,
    publicId: str(doc.publicId),
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    archivedAt: archivedAtOf(published ?? draft),
    publishedAt: publishedAtOf(published),
    unpublishOn: unpublishOnOf(published, (deps.now ?? (() => new Date()))()),
    state: stateOf(published, draft, (deps.now ?? (() => new Date()))()),
    title: localized(doc.title),
    shortDescription: localized(doc.shortDescription),
    color: colorOf(doc.color),
    image: await readImage(client, objectOf(doc.image)?._ref, grant.projectSlug),
    slug: slugsOf(doc),
    pageSegments: await readPageSegments(client, grant.projectSlug),
    palette: await soft<CoursePaletteSource>(() => (deps.paletteSource ?? ((slug: string) => readCoursePaletteSource(client, slug)))(grant.projectSlug), { light: null, dark: null }),
    site,
  }
}

/** Exported so tests assert exactly what runs: the Courses installation's `courseSegment` (raw localizedString). */
export const COURSE_SEGMENT_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "courses" && enabled != false][0].config.courseSegment`

/** The site's course page segments per language; {} when none is set (or it cannot be read — only the hint depends on it). */
async function readPageSegments(client: Client, projectSlug: string): Promise<Record<string, string>> {
  try {
    return cleanCourseSegments(await client.fetch<unknown>(COURSE_SEGMENT_QUERY, { projectSlug }))
  } catch {
    return {}
  }
}

/** Exported so tests assert exactly what runs: every course's page addresses (drafts and published) of this project. */
export const COURSE_SLUGS_QUERY = /* groq */ `*[_type == "course" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, slug, redirectFrom }`

type SlugRow = { _id?: string; slug?: unknown; redirectFrom?: unknown }

/** Addresses other courses use or used in `locale` (current + retired): reusing a retired one would hijack its redirect. */
function takenSlugs(rows: readonly SlugRow[] | null | undefined, id: string, locale: string): Set<string> {
  const taken = new Set<string>()
  for (const row of rows ?? []) {
    if (row._id === id || row._id === `drafts.${id}`) continue
    const cur = slugsOf(row as Doc)[locale]
    if (cur) taken.add(cur)
    for (const old of strings(objectOf(row.redirectFrom)?.[locale])) taken.add(old)
  }
  return taken
}

/** The image behind a course's reference: this website's asset only, else null (a dangling or foreign reference shows nothing). */
async function readImage(client: Client, ref: unknown, projectSlug: string): Promise<CourseImage | null> {
  const assetId = str(ref)
  if (!assetId || !ASSET_ID.test(assetId)) return null
  const row = await client.fetch<{ url?: unknown; alt?: unknown } | null>(
    `*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug][0]{ "url": image.asset->url, "alt": altText }`,
    { id: assetId, projectSlug }
  )
  if (!row) return null
  return { assetId, url: typeof row.url === 'string' ? row.url : null, alt: localized(row.alt) }
}

// ── Validation helpers ────────────────────────────────────────────────────────

function cleanText(value: unknown, max: number, what: string, multiline = false): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new CourseError('invalid_value', `${what} must be text.`)
  const t = multiline ? value.replace(/\r\n/g, '\n').trim() : value.trim().replace(/\s+/g, ' ')
  if (t.length > max) throw new CourseError('too_large', `${what} is too long.`)
  return t
}

/** Locales a draft may hold: the site's, plus any already stored in it (a removed site language never loses text on save). */
function allowedLocales(site: CourseSite, draft: Doc | undefined): Set<string> {
  const allowed = new Set(site.languages)
  for (const f of LOCALIZED_FIELDS) for (const k of Object.keys(objectOf(draft?.[f]) ?? {})) if (LOCALE_KEY.test(k)) allowed.add(k)
  return allowed
}

// ── Create / open ─────────────────────────────────────────────────────────────

/** A new, unpublished course (draft only). The title is in the site's default language. Write permission. */
export async function createCourse(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { title: string },
  deps: CourseDeps = {}
): Promise<{ id: string; publicId: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  return audited({ ctx, projectId, contentType: 'course', contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const title = cleanText(input?.title, COURSE_LIMITS.title, 'The title')
    if (!title) throw new CourseError('missing_title', 'A title is required.')
    const [site, count] = await Promise.all([
      readSite(client, grant.projectSlug),
      client.fetch<number | null>(`count(*[_type == "course" && projectSlug == $projectSlug && !(_id in path("versions.**"))])`, { projectSlug: grant.projectSlug }, RAW),
    ])
    if ((count ?? 0) >= COURSE_LIMITS.courses * 2) throw new CourseError('too_large', 'This site has too many courses.')
    const publicId = (deps.publicUuid ?? randomUUID)()
    const doc = {
      _id: `drafts.${id}`,
      _type: 'course',
      projectSlug: grant.projectSlug,
      publicId,
      title: { _type: 'localizedString', [site.defaultLocale]: title },
      color: DEFAULT_COURSE_COLOR,
    }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, publicId, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published course. A server action, never a GET. */
export async function openCourseForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: CourseDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const id = input?.id
  if (!isCourseId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (archivedAtOf(published)) throw new CourseError('archived', 'Restore this course to edit it.')
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'course'
  copy.projectSlug = grant.projectSlug
  await singleProjectGuard(client, grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string }
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
      throw new CourseError('conflict', 'This course was changed elsewhere.')
    }
    throw new CourseError('failed', 'Could not open the course.')
  }
}

// ── Save draft ────────────────────────────────────────────────────────────────

/** Paths `saveCourseDraft` accepts. `<loc>` = a language of the site. */
export const COURSE_PATCH_FIELDS = ['title.<loc>', 'shortDescription.<loc>', 'slug.<loc>', 'color', 'image'] as const

/**
 * Applies the typed changes to the draft. Incomplete drafts always save (a
 * cleared title is allowed; Publish refuses it). Write permission; the draft
 * revision must match (`conflict` otherwise).
 */
export async function saveCourseDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: CourseDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isCourseId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new CourseError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new CourseError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > COURSE_LIMITS.patchBytes) throw new CourseError('too_large', 'Too much at once.')
  // Field allow-list before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const ok = path === 'color' || path === 'image' || ((field === 'slug' || (LOCALIZED_FIELDS as readonly string[]).includes(field)) && !!locale && LOCALE_KEY.test(locale) && rest.length === 0)
    if (!ok) throw new CourseError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, CourseSite, void]>([
    readPair(client, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (draft!._rev !== input.rev) throw new CourseError('conflict', 'This course was edited elsewhere.')
  if (archivedAtOf(published ?? draft)) throw new CourseError('archived', 'Restore this course to edit it.')

  const allowed = allowedLocales(site, draft)
  for (const k of Object.keys(objectOf(draft?.slug) ?? {})) if (LOCALE_KEY.test(k)) allowed.add(k)
  let imageId: string | null = null
  const slugChecks: Array<{ locale: string; slug: string }> = []
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(input.set)) {
    if (path === 'color') {
      if (!isCourseColor(value)) throw new CourseError('invalid_value', 'Unknown colour.')
      set.color = value
      continue
    }
    if (path === 'image') {
      // null / '' removes the image; otherwise a Media Library asset id of THIS website (checked below).
      if (value === null || value === '') {
        unset.push('image')
        continue
      }
      if (typeof value !== 'string' || !ASSET_ID.test(value)) throw new CourseError('invalid_value', 'Unknown image.')
      imageId = value
      set.image = { _type: 'reference', _ref: value }
      continue
    }
    if (path.startsWith('slug.')) {
      const locale = path.slice('slug.'.length)
      if (!allowed.has(locale)) throw new CourseError('invalid_field', `Language "${locale}" is not on this site.`)
      if (value !== null && typeof value !== 'string') throw new CourseError('invalid_value', 'A page address must be text.')
      const raw = typeof value === 'string' ? value : ''
      const slug = courseSlugFrom(raw)
      if (raw.trim() && !COURSE_SLUG_PATTERN.test(slug)) throw new CourseError('invalid_value', 'Not a valid web address part.')
      ensure.slug = { _type: 'localizedSlug' }
      if (slug) {
        set[path] = { _type: 'slug', current: slug }
        slugChecks.push({ locale, slug })
      } else unset.push(path)
      continue
    }
    const [field, locale] = path.split('.') as [(typeof LOCALIZED_FIELDS)[number], string]
    if (!allowed.has(locale)) throw new CourseError('invalid_field', `Language "${locale}" is not on this site.`)
    ensure[field] = { _type: LOCALIZED_TYPE[field] }
    const t = cleanText(value, field === 'title' ? COURSE_LIMITS.title : COURSE_LIMITS.shortDescription, `"${path}"`, field === 'shortDescription')
    if (t) set[path] = t
    else unset.push(path)
  }

  if (imageId) {
    const ok = await client.fetch<string | null>(`*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset)][0]._id`, { id: imageId, projectSlug: grant.projectSlug })
    if (ok !== imageId) throw new CourseError('invalid_value', 'That image is not in this website’s Media Library.')
  }
  if (slugChecks.length) {
    const rows = await client.fetch<SlugRow[] | null>(COURSE_SLUGS_QUERY, { projectSlug: grant.projectSlug }, RAW)
    for (const { locale, slug } of slugChecks) {
      if (takenSlugs(rows, input.id, locale).has(slug)) throw new CourseError('slug_taken', 'Another course already uses this web address.')
    }
  }

  const result = (await commit(
    client,
    grant.projectSlug,
    () => {
      let p = client.patch(draftId).ifRevisionId(input.rev)
      if (Object.keys(ensure).length) p = p.setIfMissing(ensure)
      if (Object.keys(set).length) p = p.set(set)
      if (unset.length) p = p.unset(unset)
      return p.commit(DRAFT_SAVE)
    },
    guard
  )) as { _rev?: string } | undefined
  return { rev: result?._rev ?? '' }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

/** How the go-live date is set: `now`, `schedule` (a future `publishAt`), `keep` ("Update": a published course keeps its date; a never-published one goes live now). */
export type PublishCourseInput = { id: string; rev: string; mode?: 'now' | 'schedule' | 'keep'; publishAt?: string }

/** A go-live date may lie at most two years ahead (same rule as posts). */
export const COURSE_MAX_SCHEDULE_MS = 2 * 366 * 24 * 60 * 60 * 1000
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/** A valid future go-live date within two years, else `invalid_schedule`. */
export function parseCoursePublishAt(value: unknown, now: Date): Date {
  const at = typeof value === 'string' && ISO.test(value) ? new Date(value) : null
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= now.getTime() || at.getTime() - now.getTime() > COURSE_MAX_SCHEDULE_MS) {
    throw new CourseError('invalid_schedule', 'Pick a date and time in the future, within two years.')
  }
  return at
}

/** Publish = online: refuses when neither a timetable on a published page nor a course page would show the course (`no_timetable_page`). */
async function assertWillAppear(client: Client, projectSlug: string, courseId: string, deps: CourseDeps) {
  let info: PlacementInfo
  try {
    info = await (deps.placement ?? ((slug: string) => readPlacementInfo(client, slug, courseId)))(projectSlug)
  } catch {
    throw new CourseError('failed', 'Could not check the website.')
  }
  if (!coursePlacement(info, courseId).onWebsite) throw new CourseError('no_timetable_page', 'No timetable on the website shows this course.')
}

/**
 * Makes the draft the live course. Needs a title in the site's main language,
 * and (unless it is only an update of a course that is already published) a
 * timetable on a published page that shows the course. Dates:
 *   now      → publishedAt = now (a live course keeps its own date)
 *   schedule → publishedAt = a future moment: the course is a published
 *              document that the website shows once the date has passed
 *              (no cron: COURSE_VISIBLE compares publishedAt with now())
 *   keep     → a published course keeps its publishedAt; a new one = now
 * Write permission.
 */
export async function publishCourseDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: PublishCourseInput,
  deps: CourseDeps = {}
): Promise<{ rev: string; publishedAt: string | null }> {
  return audited(
    { ctx, projectId, contentType: 'course', contentId: isCourseId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      const now = (deps.now ?? (() => new Date()))()
      if (!isCourseId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new CourseError('conflict', 'Missing revision.')
      const mode = input.mode ?? 'keep'
      if (mode !== 'now' && mode !== 'schedule' && mode !== 'keep') throw new CourseError('invalid_value', 'Unknown publish mode.')
      const scheduledAt = mode === 'schedule' ? parseCoursePublishAt(input.publishAt, now) : null
      const [{ published, draft }, site] = await Promise.all([readPair(client, input.id, grant.projectSlug), readSite(client, grant.projectSlug)])
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new CourseError('conflict', 'This course was edited elsewhere.')
      if (archivedAtOf(published ?? draft)) throw new CourseError('archived', 'Restore this course before publishing.')
      if (!localized(draft.title)[site.defaultLocale]) throw new CourseError('missing_title', 'A title in the main language is required.')

      // A live course keeps its date unless it is scheduled to a new one; a scheduled course published "now" goes live now.
      const live = Boolean(published) && windowStatus(published, now).status === 'published'
      // An unpublished course goes back on the website: publishing it again is like a first publish (the website check runs).
      const wasUnpublished = isUnpublished(published, now)
      // A live course is never moved into the future (that would take it offline).
      if (live && mode === 'schedule') throw new CourseError('invalid_value', 'This course is already online.')
      const keepDate = Boolean(published) && (mode === 'keep' || (mode === 'now' && live))
      const publishedAt: string | null = keepDate ? publishedAtOf(published) : (scheduledAt ?? now).toISOString()
      // Only an update of a course that is already published (and on the website) can skip the check.
      if (!(published && mode === 'keep') || wasUnpublished) await assertWillAppear(client, grant.projectSlug, input.id, deps)

      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = 'course'
      doc.projectSlug = grant.projectSlug
      if (publishedAt) doc.publishedAt = publishedAt
      // A future unpublish date survives an update ("Unpublish on…" stays set); a passed one is dropped —
      // publishing an unpublished course puts it back on the website.
      const unpublishOn = unpublishOnOf(published, now)
      if (unpublishOn && (!publishedAt || Date.parse(unpublishOn) > Date.parse(publishedAt))) doc.expiresAt = unpublishOn
      // The publicId never changes once published (class schedules key on it).
      if (published && typeof published.publicId === 'string' && published.publicId) doc.publicId = published.publicId
      if (typeof doc.publicId !== 'string' || !UUID_RE.test(doc.publicId)) doc.publicId = (deps.publicUuid ?? randomUUID)()

      // Page addresses (ADR-045 D5): every language with a title and no address gets one from its title.
      const slugs = slugsOf(draft)
      const titles = localized(draft.title)
      const missing = Object.keys(titles).filter((l) => !slugs[l] && courseSlugFrom(titles[l]))
      if (missing.length) {
        const rows = await client.fetch<SlugRow[] | null>(COURSE_SLUGS_QUERY, { projectSlug: grant.projectSlug }, RAW)
        for (const locale of missing) slugs[locale] = uniqueCourseSlug(courseSlugFrom(titles[locale]), takenSlugs(rows, input.id, locale))
      }
      if (Object.keys(slugs).length) {
        doc.slug = { _type: 'localizedSlug', ...Object.fromEntries(Object.entries(slugs).map(([l, cur]) => [l, { _type: 'slug', current: cur }])) }
      }
      // Publicly Routable Content Pattern: a published address that changes keeps working as a redirect.
      if (published) {
        const before = slugsOf(published)
        const redirects: Record<string, unknown> = { _type: 'redirectFrom', ...(objectOf(draft.redirectFrom) ?? objectOf(published.redirectFrom) ?? {}) }
        let changed = false
        for (const [loc, old] of Object.entries(before)) {
          if (slugs[loc] === old) continue
          const list = strings(redirects[loc]).filter((x) => x !== slugs[loc])
          if (!list.includes(old)) list.push(old)
          redirects[loc] = list
          changed = true
        }
        // An address taken back from the retired list no longer redirects.
        for (const [loc, cur] of Object.entries(slugs)) {
          const list = strings(redirects[loc])
          if (list.includes(cur)) {
            redirects[loc] = list.filter((x) => x !== cur)
            changed = true
          }
        }
        if (changed) doc.redirectFrom = redirects
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
      const state = snapshotOf(doc)
      // published / scheduled / schedule_changed from the published state before and after; a plain content update records nothing.
      return { value: { rev: transactionId, publishedAt }, action: lifecycleAction(snapshotOf(published), state, 'optional', now), state }
    }
  )
}

/**
 * Changes the go-live date of a SCHEDULED course without touching its content
 * (the dashboard's "Change date" and "Publish now instead"). `now` puts it on
 * the website at once. Only a scheduled course can be re-dated: moving a live
 * course into the future would take it offline. Same timetable check as
 * publishing. Write permission.
 */
export async function setCoursePublishDate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; mode: 'now' | 'schedule'; publishAt?: string },
  deps: CourseDeps = {}
): Promise<{ publishedAt: string }> {
  const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const now = (deps.now ?? (() => new Date()))()
  if (!isCourseId(input?.id)) notFound()
  if (input.mode !== 'now' && input.mode !== 'schedule') throw new CourseError('invalid_value', 'Unknown publish mode.')
  if (input.mode === 'schedule') parseCoursePublishAt(input.publishAt, now)
  const { published } = await readPair(client as Client, input.id, grant.projectSlug)
  if (!published) throw new CourseError('invalid_value', 'Publish this course first.')
  if (archivedAtOf(published)) throw new CourseError('archived', 'Restore this course first.')
  if (!isScheduled(published, now)) throw new CourseError('invalid_value', 'This course is not waiting for a date.')
  await assertWillAppear(client as Client, grant.projectSlug, input.id, deps)
  const d = courseLifecycle({ projectId, publicId: null, hasSchedule: noSchedule })
  const r = await lifecycle.setDates(
    d,
    ctx,
    projectId,
    { id: input.id, rev: str(published._rev), publishedAt: input.mode === 'now' ? 'now' : new Date(input.publishAt as string).toISOString(), expiresAt: null },
    { client, now: deps.now, audit: deps.audit }
  )
  return { publishedAt: str(r.doc.publishedAt) }
}

/**
 * "Back to draft": takes a SCHEDULED course off its date. The published version
 * (which was never on the website) is removed and the course goes on as a
 * draft — the existing draft when there is one, else a copy of it. Its classes
 * stay (they are keyed on the publicId). Write permission.
 */
export async function unscheduleCourse(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: CourseDeps = {}): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: 'course', contentId: isCourseId(input?.id) ? input.id : null, intended: 'unpublished', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      const now = (deps.now ?? (() => new Date()))()
      if (!isCourseId(input?.id)) notFound()
      const { published, draft } = await readPair(client, input.id, grant.projectSlug)
      if (!published) throw new CourseError('invalid_value', 'This course is not published.')
      if (archivedAtOf(published)) throw new CourseError('archived', 'Restore this course first.')
      if (!isScheduled(published, now)) throw new CourseError('invalid_value', 'This course is not waiting for a date.')
      const draftId = `drafts.${input.id}`
      await commit(client, grant.projectSlug, () => {
        let tx = client.transaction().patch(input.id, { ifRevisionID: published._rev ?? '', unset: ['_publishGuard'] })
        if (draft?._rev) {
          tx = tx.patch(draftId, { ifRevisionID: draft._rev, unset: ['_publishGuard'] })
        } else {
          const copy: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
          copy._id = draftId
          copy._type = 'course'
          copy.projectSlug = grant.projectSlug
          tx = tx.create(copy as { _id: string; _type: string })
        }
        return tx.delete(input.id).commit({ transactionId })
      })
      return { value: { rev: transactionId }, action: 'unpublished' as const, state: null }
    }
  )
}

/** Throws away unpublished changes of a published course. */
export async function discardCourseDraft(ctx: TenantAuthorizationContext, projectId: string, input: { id: string; rev: string }, deps: CourseDeps = {}): Promise<void> {
  const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isCourseId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) throw new CourseError('invalid_value', 'This course was never published.')
  if (draft._rev !== input.rev) throw new CourseError('conflict', 'This course was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () => client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit())
}

// ── Archive / restore / delete ────────────────────────────────────────────────

export const COURSE_LIFECYCLE_OPS = ['archive', 'restore', 'deleteDraft', 'deletePermanently', 'unpublish', 'publishAgain'] as const
export type CourseLifecycleOp = (typeof COURSE_LIFECYCLE_OPS)[number]

/**
 * Archive / restore / unpublish / publish again (courses.course.write) and
 * delete (courses.course.delete) through the lifecycle service, which writes
 * the Activity row. Unpublish sets the unpublish date to now (the website hides
 * the course, its classes and its page at once); restore lands on Unpublished;
 * "Publish again" removes the date (refused when nothing would show the course). Delete is refused while anything references
 * the course OR it still has classes (`in_use`, `detail.usedIn`). Returns the
 * DRAFT's new revision (archive / restore also touch the draft).
 */
export async function runCourseLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: CourseLifecycleOp },
  deps: CourseDeps = {}
): Promise<{ rev: string | null }> {
  if (!(COURSE_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new CourseError('invalid_value', 'Unknown action.')
  const deleting = input.op === 'deleteDraft' || input.op === 'deletePermanently'
  // Gate before any read (the service re-checks).
  const grant = grantFor(ctx, projectId, deleting ? COURSE_DELETE_PERMISSION : COURSE_WRITE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  if (!isCourseId(input.id)) notFound()
  const hasSchedule = deps.hasSchedule ?? noSchedule
  const probe = courseLifecycle({ projectId, publicId: null, hasSchedule })
  const { published, draft } = await lifecycle.readPair(probe, client, input.id, grant.projectSlug)
  const publicId = str((published ?? draft)?.publicId)
  const d = courseLifecycle({ projectId, publicId: UUID_RE.test(publicId) ? publicId : null, hasSchedule })
  const args = { id: input.id, rev: (input.op === 'deleteDraft' ? draft?._rev : published?._rev) ?? '' }
  try {
    switch (input.op) {
      case 'archive': {
        // A scheduled course was never on the website: it goes back to draft, not into the archive (a restore would put it live at once).
        if (isScheduled(published, (deps.now ?? (() => new Date()))())) throw new CourseError('invalid_value', 'Take this course back to draft first.')
        const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'restore': {
        // Restore lands on "Unpublished" (ADR-032 D6, as posts): the service keeps the archive's
        // unpublish date, so the course comes back off the website; "Publish again" puts it back.
        const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'unpublish': {
        // Off the website now: unpublish date = now (D2 — never Sanity's Unpublish). Its classes stay.
        if (!published) throw new CourseError('invalid_value', 'This course is not published.')
        if (isUnpublished(published, (deps.now ?? (() => new Date()))())) throw new CourseError('invalid_value', 'This course is already unpublished.')
        await lifecycle.unpublishNow(d, ctx, projectId, args, sdeps)
        return { rev: null }
      }
      case 'publishAgain': {
        // Back on the website: the unpublish date is removed — if anything on the website would show it.
        if (!published || !isUnpublished(published, (deps.now ?? (() => new Date()))())) throw new CourseError('invalid_value', 'This course is not unpublished.')
        await assertWillAppear(client as Client, grant.projectSlug, input.id, deps)
        await lifecycle.backOnline(d, ctx, projectId, args, sdeps)
        return { rev: null }
      }
      case 'deleteDraft':
        await lifecycle.deleteDraft(d, ctx, projectId, args, sdeps)
        return { rev: null }
      case 'deletePermanently':
        await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
        return { rev: null }
    }
  } catch (error) {
    const referrers = (error as { referrers?: lifecycle.Referrer[] } | null)?.referrers
    if (error instanceof CourseError && error.code === 'in_use' && referrers?.length) {
      const usedIn: CourseUsage[] = referrers.map((r) =>
        r.type === 'classes'
          ? { kind: 'classes' as const, id: '', title: r.label }
          : { kind: r.type === 'post' ? ('post' as const) : r.type === 'event' ? ('event' as const) : ('page' as const), id: r.id, title: r.label }
      )
      throw new CourseError('in_use', error.message, { usedIn })
    }
    throw error
  }
}

// ── Unpublish on… ─────────────────────────────────────────────────────────────

/**
 * "Unpublish on…": the date a published course leaves the website by itself
 * (`expiresAt`, ADR-032 D5) — or null to remove it. Never archives: when the
 * date passes the course is Unpublished, its classes stay in the dashboard.
 * Refused for a course that is not published, archived, or already
 * unpublished (a future date would quietly put it back online). The date must
 * be in the future and after the go-live date. Write permission; Activity row
 * via the lifecycle service.
 */
export async function setCourseUnpublishDate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; unpublishAt: string | null },
  deps: CourseDeps = {}
): Promise<{ unpublishOn: string | null }> {
  const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const now = (deps.now ?? (() => new Date()))()
  if (!isCourseId(input?.id)) notFound()
  if (input.unpublishAt !== null && (typeof input.unpublishAt !== 'string' || !ISO.test(input.unpublishAt))) throw new CourseError('invalid_schedule', 'Pick a date and time in the future.')
  const { published } = await readPair(client as Client, input.id, grant.projectSlug)
  if (!published) throw new CourseError('invalid_value', 'Publish this course first.')
  if (archivedAtOf(published)) throw new CourseError('archived', 'Restore this course first.')
  if (isUnpublished(published, now)) throw new CourseError('invalid_value', 'This course is already unpublished.')
  if (input.unpublishAt !== null) {
    const at = Date.parse(input.unpublishAt)
    const goLive = publishedAtOf(published)
    if (at <= now.getTime() || at - now.getTime() > COURSE_MAX_SCHEDULE_MS || (goLive && at <= Date.parse(goLive))) {
      throw new CourseError('invalid_schedule', 'Pick a date and time in the future, after the go-live date.')
    }
  }
  const d = courseLifecycle({ projectId, publicId: null, hasSchedule: noSchedule })
  const r = await lifecycle.setEndDate(
    d,
    ctx,
    projectId,
    { id: input.id, rev: str(published._rev), expiresAt: input.unpublishAt === null ? null : new Date(Date.parse(input.unpublishAt)).toISOString() },
    { client, now: deps.now, audit: deps.audit }
  )
  return { unpublishOn: typeof r.doc.expiresAt === 'string' ? r.doc.expiresAt : null }
}

// ── Activity ──────────────────────────────────────────────────────────────────

/** The course's Activity (ADR-032 D9). Read permission; the course must be this project's. */
export async function getCourseActivity(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: CourseDeps = {}): Promise<ActivityItem[]> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isCourseId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  return (deps.read ?? readContentActivity)({ projectId, contentType: 'course', contentIds: [input.id] })
}
