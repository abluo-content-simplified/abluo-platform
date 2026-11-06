/**
 * Client dashboard — course schedules (ADR-045, ADR-038 Amendment A, timetable
 * build spec §4): the Classes panel of the course editor and the Timetable page.
 *
 * Thin, checked layer between the server actions and the scheduling stores
 * (`course-store.ts` / `course-guarded.server.ts`). Enforcement, in order:
 *   1. `assertModuleAction(ctx, projectId, permission)` BEFORE any I/O; the
 *      project id, project slug and identity come from the GRANT, never input.
 *        courses.course.read      read the classes and the timetable
 *        courses.schedule.write   classes, single dates, terms, holidays
 *        courses.meeting.manage   online-room details (owner only)
 *   2. Every write goes through the guarded entry (`saveClassGuarded`, …): the
 *      course, the place and the teachers must belong to the grant's project.
 *      A class, date, term or room is always looked up inside the grant's
 *      project first, so an id of another website is simply "not_found".
 *   3. Meeting details (join link, meeting id, passcode) are returned ONLY to
 *      `courses.meeting.manage`; everyone else sees the room's label.
 *   4. Failures are opaque `CourseErrorCode`s (the scheduling layer's codes are
 *      mapped: invalid → invalid_value, unavailable → failed).
 *
 * Times are wall-clock in the site's time zone ("HH:mm", 24-hour); dates are
 * "YYYY-MM-DD". Nothing here formats text — the dashboard does, in the viewer's
 * language.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { CourseError, COURSE_READ_PERMISSION, UUID_RE, type CourseErrorCode } from '@/lib/api/course-lifecycle'
import type { CourseScheduleSummary } from '@/lib/api/course-drafts'
import { PERSON_PICKER_QUERY } from '@/lib/api/persons'
import type { assertPeopleBelongToProject } from '@/lib/api/persons-guard'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { COURSES_PERMISSIONS } from '@/lib/modules/courses/model'
import { personDisplayName } from '@/lib/modules/people/model'
import {
  createCourseScheduleStore,
  type CourseScheduleStore,
} from '@/lib/scheduling/course-store'
import {
  endClassGuarded,
  saveClassGuarded,
  saveEditionGuarded,
  updateOccurrenceGuarded,
} from '@/lib/scheduling/course-guarded.server'
import { coerceClassRule, parseClassRule, type ClassRule } from '@/lib/scheduling/recurrence'
import { ScheduleError, type AttendanceMode, type ClassOccurrence, type ClassSeries, type MeetingRoom, type SchedulePlace } from '@/lib/scheduling/types'

export const SCHEDULE_WRITE_PERMISSION = COURSES_PERMISSIONS.scheduleWrite
export const MEETING_MANAGE_PERMISSION = COURSES_PERMISSIONS.meetingManage

// ── Views (what the dashboard receives) ──────────────────────────────────────

export type ScheduleSite = {
  defaultLocale: string
  /** languages[0] = the default language. */
  languages: string[]
  /** The site's IANA zone (null = not set). */
  timeZone: string | null
}

export type PersonRef = { publicId: string; name: string }

export type PlaceOption = {
  /** `location:<key>` or `venue:<publicId>`. */
  token: string
  name: string
  kind: 'location' | 'venue'
}

export type ClassView = {
  id: string
  /** The course's permanent publicId. */
  courseId: string
  editionId: string | null
  /** The FIRST weekday of the class, 1 = Monday … 7 = Sunday (sorting; for monthly-by-date / once: the weekday of the first date). */
  weekday: number
  /** Every weekday the class meets (several for "Monday + Wednesday"); where a class is placed on a weekday grid. */
  weekdays: number[]
  /** Every N weeks (1 unless weekly). */
  interval: number
  /** The repeat preset (once / weekly on days / monthly on the nth weekday / monthly on day N); null for an unknown stored rule. */
  repeat: ClassRule | null
  /** The stored rule text, for `describeClassRepeat`. */
  rule: string | null
  startTime: string
  endTime: string | null
  timeZone: string
  startsOn: string | null
  endsOn: string | null
  /** '' = no place. */
  placeToken: string
  attendanceMode: AttendanceMode
  instructors: PersonRef[]
  languages: string[]
  meetingRoomId: string | null
  /** Label only — the details are never part of a class. */
  meetingRoomLabel: string | null
  version: number
}

export type EditionView = {
  id: string
  label: Record<string, string>
  startsOn: string
  endsOn: string
  timeZone: string
  version: number
}

export type ClosureView = { id: string; editionId: string | null; startsOn: string; endsOn: string; label: Record<string, string> }

/** The label for everyone; the details only with `courses.meeting.manage` (otherwise the keys are absent). */
export type RoomView = {
  id: string
  label: string
  joinUrl?: string | null
  meetingId?: string | null
  passcode?: string | null
  note?: Record<string, string> | null
  version?: number
}

export type OccurrenceView = {
  id: string
  seriesId: string
  originalStartLocal: string | null
  /** 'YYYY-MM-DD' (site zone). */
  date: string
  startTime: string
  endTime: string | null
  cancelled: boolean
  /** The date's own time (moved by hand). */
  isModified: boolean
  instructors: PersonRef[]
  /** The date has teachers different from the class's. */
  substituted: boolean
  note: Record<string, string> | null
  version: number
}

export type ClassesScreen = {
  site: ScheduleSite
  classes: ClassView[]
  editions: EditionView[]
  places: PlaceOption[]
  rooms: RoomView[]
  canManageRooms: boolean
}

export type TimetableScreen = {
  site: ScheduleSite
  classes: ClassView[]
  editions: EditionView[]
  closures: ClosureView[]
  places: PlaceOption[]
  rooms: RoomView[]
  canManageRooms: boolean
  /** Course publicId → title in the site's default language (else the first written). */
  courses: Record<string, string>
  /** Series id → dates in the window that are cancelled or edited. */
  exceptions: Record<string, number>
  window: { from: string; to: string }
}

export type SaveClassResult = { seriesId: string; version: number; truncated: boolean; keptEdited: number }

export const SCHEDULE_LIMITS = { occurrences: 60, labelLength: 200, noteLength: 600 } as const

// ── Plumbing ──────────────────────────────────────────────────────────────────

type Fetcher = { fetch: (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }
export type CourseScheduleDeps = {
  client?: Fetcher
  store?: CourseScheduleStore
  assertPeople?: typeof assertPeopleBelongToProject
  now?: () => Date
}

const RAW = { perspective: 'raw' } as const
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const PLACE_TOKEN = /^(location:[a-z0-9_-]{1,64}|venue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const DEFAULT_WINDOW_DAYS = 56

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

const clientOf = (deps: CourseScheduleDeps) => deps.client ?? (sanityWriteClient as unknown as Fetcher)
const storeOf = (deps: CourseScheduleDeps) => deps.store ?? createCourseScheduleStore()
const guardDeps = (deps: CourseScheduleDeps) => ({ client: deps.client, assertPeople: deps.assertPeople, store: deps.store })

const CODE: Record<ScheduleError['code'], CourseErrorCode> = { conflict: 'conflict', not_found: 'not_found', invalid: 'invalid_value', unavailable: 'failed', outside_term: 'outside_term' }

/** Runs a scheduling call and turns its errors into opaque course error codes. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ScheduleError) throw new CourseError(CODE[error.code], error.message)
    throw error
  }
}

const invalid = (message = 'Something is not right.') => new CourseError('invalid_value', message)
const notFound = () => new CourseError('not_found', 'Unknown class.')

async function fetchRaw(deps: CourseScheduleDeps, query: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await clientOf(deps).fetch(query, params, RAW)
  } catch {
    throw new CourseError('failed', 'Could not read the website.')
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function localized(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

const firstOf = (map: Record<string, string>, defaultLocale: string) => map[defaultLocale] ?? Object.values(map)[0] ?? ''

const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales, timeZone }`

async function readSite(deps: CourseScheduleDeps, projectSlug: string): Promise<ScheduleSite> {
  const site = (await fetchRaw(deps, SITE_QUERY, { projectSlug })) as { defaultLocale?: string | null; supportedLocales?: string[] | null; timeZone?: string | null } | null
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new CourseError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)], timeZone: typeof site?.timeZone === 'string' && site.timeZone ? site.timeZone : null }
}

/** Locations and saved venues (venues by their permanent publicId — what a class stores). */
export const PLACE_OPTIONS_QUERY = /* groq */ `{
  "locations": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].locations[]{ key, name },
  "venues": *[_type == "eventVenue" && projectSlug == $projectSlug && !(_id in path("drafts.**"))] | order(_createdAt asc){ publicId, name }
}`

async function readPlaces(deps: CourseScheduleDeps, projectSlug: string, defaultLocale: string): Promise<PlaceOption[]> {
  const row = (await fetchRaw(deps, PLACE_OPTIONS_QUERY, { projectSlug })) as { locations?: unknown; venues?: unknown } | null
  const name = (v: unknown) => {
    const l = localized(v)
    return l[defaultLocale] ?? l.en ?? Object.values(l)[0] ?? ''
  }
  const locations = (Array.isArray(row?.locations) ? row.locations : [])
    .filter((l): l is { key: string; name?: unknown } => typeof (l as { key?: unknown })?.key === 'string')
    .map((l): PlaceOption => ({ token: `location:${l.key}`, name: name(l.name) || l.key, kind: 'location' }))
  const venues = (Array.isArray(row?.venues) ? row.venues : [])
    .filter((v): v is { publicId: string; name?: unknown } => typeof (v as { publicId?: unknown })?.publicId === 'string' && UUID_RE.test((v as { publicId: string }).publicId))
    .map((v): PlaceOption => ({ token: `venue:${v.publicId.toLowerCase()}`, name: name(v.name) || v.publicId, kind: 'venue' }))
  return [...locations, ...venues]
}

const PEOPLE_NAMES_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && publicId in $ids && !(_id in path("versions.**"))]{ _id, publicId, firstName, lastName, displayName }`

/** publicId (lower-case) → name, for the people a set of classes or dates names. */
async function readPeople(deps: CourseScheduleDeps, projectSlug: string, publicIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set([...publicIds].filter((x) => UUID_RE.test(x)).map((x) => x.toLowerCase()))]
  const out = new Map<string, string>()
  if (!ids.length) return out
  const rows = (await fetchRaw(deps, PEOPLE_NAMES_QUERY, { projectSlug, ids })) as Array<{ _id?: string; publicId?: string }> | null
  // A draft carries the newest name; published ones fill the rest.
  const sorted = [...(rows ?? [])].sort((a, b) => Number(String(b._id).startsWith('drafts.')) - Number(String(a._id).startsWith('drafts.')))
  for (const r of sorted) {
    const key = str(r.publicId).toLowerCase()
    if (key && !out.has(key)) out.set(key, personDisplayName(r) || '—')
  }
  return out
}

const refsOf = (ids: readonly string[], names: Map<string, string>): PersonRef[] => ids.map((publicId) => ({ publicId, name: names.get(publicId.toLowerCase()) ?? '—' }))

function placeTokenOf(p: SchedulePlace | null): string {
  if (!p) return ''
  return p.kind === 'location' ? `location:${p.key}` : `venue:${p.venuePublicId.toLowerCase()}`
}

function placeOf(token: unknown): SchedulePlace | null {
  if (token === '' || token === null || token === undefined) return null
  if (typeof token !== 'string' || !PLACE_TOKEN.test(token)) throw invalid('Unknown place.')
  const [kind, value] = [token.slice(0, token.indexOf(':')), token.slice(token.indexOf(':') + 1)]
  return kind === 'location' ? { kind: 'location', key: value } : { kind: 'venue', venuePublicId: value.toLowerCase() }
}

function classView(s: ClassSeries, names: Map<string, string>, rooms: Map<string, string>): ClassView {
  return {
    id: s.id,
    courseId: s.ownerPublicId,
    editionId: s.editionId,
    weekday: s.weekday ?? 1,
    weekdays: s.weekdays?.length ? s.weekdays : [s.weekday ?? 1],
    interval: s.interval,
    repeat: parseClassRule(s.rule),
    rule: s.rule,
    startTime: s.startLocal.slice(11, 16),
    endTime: s.endLocal ? s.endLocal.slice(11, 16) : null,
    timeZone: s.timeZone,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    placeToken: placeTokenOf(s.place),
    attendanceMode: s.attendanceMode,
    instructors: refsOf(s.instructorPublicIds, names),
    languages: s.languages,
    meetingRoomId: s.meetingRoomId,
    meetingRoomLabel: s.meetingRoomId ? (rooms.get(s.meetingRoomId) ?? null) : null,
    version: s.version,
  }
}

const editionView = (e: { id: string; label: Record<string, string>; startsOn: string; endsOn: string; timeZone: string; version: number }): EditionView => ({
  id: e.id,
  label: e.label,
  startsOn: e.startsOn,
  endsOn: e.endsOn,
  timeZone: e.timeZone,
  version: e.version,
})

function roomView(r: MeetingRoom, manage: boolean): RoomView {
  return manage ? { id: r.id, label: r.label, joinUrl: r.joinUrl, meetingId: r.meetingId, passcode: r.passcode, note: r.note, version: r.version } : { id: r.id, label: r.label }
}

function assertUuid(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid(`Not a valid ${what}.`)
}

function assertDay(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) throw invalid(`The ${what} is not valid.`)
}

function assertTime(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !TIME.test(value)) throw invalid(`The ${what} is not valid.`)
}

/** A text per language of the site: only the site's languages, trimmed, bounded. */
function cleanTexts(value: unknown, site: ScheduleSite, max: number, what: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`The ${what} is not valid.`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LOCALE_KEY.test(k) || !site.languages.includes(k) || typeof v !== 'string') throw invalid(`The ${what} is not valid.`)
    const t = v.trim().replace(/\s+/g, ' ')
    if (t.length > max) throw new CourseError('too_large', `The ${what} is too long.`)
    if (t) out[k] = t
  }
  return out
}

/** The zone classes and terms are entered in: the site's, else the one the dashboard worked in. */
function zoneFor(site: ScheduleSite, requested: unknown): string {
  const zone = site.timeZone ?? (typeof requested === 'string' ? requested : null)
  if (!zone) throw invalid('Unknown time zone.')
  return zone
}

/** The class must exist in the grant's project (live classes only). */
async function seriesOf(store: CourseScheduleStore, projectId: string, seriesId: unknown, courseId?: string): Promise<ClassSeries> {
  if (typeof seriesId !== 'string' || !UUID_RE.test(seriesId)) throw notFound()
  const found = (await guarded(() => store.listSeries(projectId, courseId ? { ownerPublicIds: [courseId] } : {}))).find((s) => s.id === seriesId)
  if (!found) throw notFound()
  return found
}

// ── Reading ───────────────────────────────────────────────────────────────────

/** One course's weekly classes with what the Classes panel needs to edit them. courses.course.read. */
export async function listClasses(ctx: TenantAuthorizationContext, projectId: string, input: { courseId: string }, deps: CourseScheduleDeps = {}): Promise<ClassesScreen> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  assertUuid(input?.courseId, 'course')
  const store = storeOf(deps)
  const manage = grant.permissions.includes(MEETING_MANAGE_PERMISSION)
  const site = await readSite(deps, grant.projectSlug)
  const [series, editions, rooms, places] = await Promise.all([
    guarded(() => store.listSeries(projectId, { ownerPublicIds: [input.courseId.toLowerCase()] })),
    guarded(() => store.listEditions(projectId, { ownerType: null })),
    guarded(() => store.listMeetingRooms(projectId)),
    readPlaces(deps, grant.projectSlug, site.defaultLocale),
  ])
  const names = await readPeople(deps, grant.projectSlug, series.flatMap((s) => s.instructorPublicIds))
  const labels = new Map(rooms.map((r) => [r.id, r.label]))
  return {
    site,
    classes: series.map((s) => classView(s, names, labels)).sort(byWeekThenTime),
    editions: editions.map(editionView),
    places,
    rooms: rooms.map((r) => roomView(r, manage)),
    canManageRooms: manage,
  }
}

const byWeekThenTime = (a: ClassView, b: ClassView) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)

function assertWindow(window: unknown, now: Date): { from: string; to: string } {
  if (window === undefined || window === null) {
    return { from: now.toISOString(), to: new Date(now.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000).toISOString() }
  }
  const w = window as { from?: unknown; to?: unknown }
  const from = typeof w.from === 'string' ? Date.parse(w.from) : NaN
  const to = typeof w.to === 'string' ? Date.parse(w.to) : NaN
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > 400 * 86_400_000) throw invalid('The dates are not valid.')
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

/**
 * The whole site's weekly classes (of one term, or all), with terms, holidays,
 * places, course titles and a count of changed dates in the window (default: the
 * next 8 weeks). courses.course.read.
 */
export async function timetable(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { window?: { from: string; to: string }; editionId?: string | null } = {},
  deps: CourseScheduleDeps = {}
): Promise<TimetableScreen> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const window = assertWindow(input?.window, (deps.now ?? (() => new Date()))())
  const editionId = input?.editionId ?? undefined
  if (editionId !== undefined) assertUuid(editionId, 'term')
  const store = storeOf(deps)
  const manage = grant.permissions.includes(MEETING_MANAGE_PERMISSION)
  const site = await readSite(deps, grant.projectSlug)
  const [series, editions, closures, rooms, places, occurrences] = await Promise.all([
    guarded(() => store.listSeries(projectId, editionId === undefined ? {} : { editionId })),
    guarded(() => store.listEditions(projectId, { ownerType: null })),
    guarded(() => store.listClosures(projectId, editionId === undefined ? {} : { editionId })),
    guarded(() => store.listMeetingRooms(projectId)),
    readPlaces(deps, grant.projectSlug, site.defaultLocale),
    guarded(() => store.occurrencesInWindow(projectId, { from: window.from, to: window.to })),
  ])
  const ownerIds = [...new Set(series.map((s) => s.ownerPublicId))]
  const [names, titles] = await Promise.all([
    readPeople(deps, grant.projectSlug, series.flatMap((s) => s.instructorPublicIds)),
    readCourseTitles(deps, grant.projectSlug, ownerIds, site.defaultLocale),
  ])
  const labels = new Map(rooms.map((r) => [r.id, r.label]))
  const live = new Set(series.map((s) => s.id))
  const exceptions: Record<string, number> = {}
  for (const o of occurrences) if (live.has(o.seriesId) && (o.status === 'cancelled' || o.isModified)) exceptions[o.seriesId] = (exceptions[o.seriesId] ?? 0) + 1
  return {
    site,
    classes: series.map((s) => classView(s, names, labels)).sort(byWeekThenTime),
    editions: editions.map(editionView),
    closures: closures.map((c) => ({ id: c.id, editionId: c.editionId, startsOn: c.startsOn, endsOn: c.endsOn, label: c.label })),
    places,
    rooms: rooms.map((r) => roomView(r, manage)),
    canManageRooms: manage,
    courses: titles,
    exceptions,
    window,
  }
}

const COURSE_TITLES_QUERY = /* groq */ `*[_type == "course" && projectSlug == $projectSlug && publicId in $ids && !(_id in path("versions.**"))]{ _id, publicId, title }`

async function readCourseTitles(deps: CourseScheduleDeps, projectSlug: string, publicIds: string[], defaultLocale: string): Promise<Record<string, string>> {
  const ids = publicIds.filter((x) => UUID_RE.test(x))
  const out: Record<string, string> = {}
  if (!ids.length) return out
  const rows = (await fetchRaw(deps, COURSE_TITLES_QUERY, { projectSlug, ids })) as Array<{ _id?: string; publicId?: string; title?: unknown }> | null
  const sorted = [...(rows ?? [])].sort((a, b) => Number(String(b._id).startsWith('drafts.')) - Number(String(a._id).startsWith('drafts.')))
  for (const r of sorted) {
    const id = str(r.publicId)
    const title = firstOf(localized(r.title), defaultLocale)
    if (id && title && !(id in out)) out[id] = title
  }
  return out
}

/** Upcoming dates of one class (from `from`, at most `count`), with who teaches each and any change. courses.course.read. */
export async function listOccurrences(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { seriesId: string; from?: string; count?: number },
  deps: CourseScheduleDeps = {}
): Promise<{ occurrences: OccurrenceView[]; hasMore: boolean; site: ScheduleSite }> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const store = storeOf(deps)
  const series = await seriesOf(store, projectId, input?.seriesId)
  if (input.from !== undefined && (typeof input.from !== 'string' || Number.isNaN(Date.parse(input.from)))) throw invalid('The date is not valid.')
  const from = input.from === undefined ? (deps.now ?? (() => new Date()))().toISOString() : new Date(Date.parse(input.from)).toISOString()
  const count = Math.max(1, Math.min(Number.isFinite(input.count) ? Math.floor(input.count as number) : 8, SCHEDULE_LIMITS.occurrences))
  const site = await readSite(deps, grant.projectSlug)
  const rows = (await guarded(() => store.occurrencesInWindow(projectId, { from, ownerPublicIds: [series.ownerPublicId], limit: 1000 }))).filter((o) => o.seriesId === series.id)
  const page = rows.slice(0, count)
  const names = await readPeople(deps, grant.projectSlug, page.flatMap((o) => o.instructorPublicIds))
  return { occurrences: page.map((o) => occurrenceView(o, series, names)), hasMore: rows.length > count, site }
}

function occurrenceView(o: ClassOccurrence, series: ClassSeries, names: Map<string, string>): OccurrenceView {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()))
  return {
    id: o.id,
    seriesId: o.seriesId,
    originalStartLocal: o.originalStartLocal,
    date: o.startLocal.slice(0, 10),
    startTime: o.startLocal.slice(11, 16),
    endTime: o.endLocal ? o.endLocal.slice(11, 16) : null,
    cancelled: o.status === 'cancelled',
    isModified: o.isModified,
    instructors: refsOf(o.instructorPublicIds, names),
    substituted: !same(o.instructorPublicIds, series.instructorPublicIds),
    note: o.note,
    version: o.version,
  }
}

/** The PersonPicker's search for teachers: this project's people (no archived, no anonymised). courses.schedule.write. */
export async function searchTeachers(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { query?: string; limit?: number } = {},
  deps: CourseScheduleDeps = {}
): Promise<Array<{ publicId: string; name: string; photoUrl: string | null; jobTitle: string }>> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  const q = typeof input?.query === 'string' ? input.query.trim().toLowerCase().slice(0, 100) : ''
  const limit = Math.max(1, Math.min(typeof input?.limit === 'number' ? Math.floor(input.limit) : 20, 50))
  const [rows, site] = await Promise.all([fetchRaw(deps, PERSON_PICKER_QUERY, { projectSlug: grant.projectSlug }), readSite(deps, grant.projectSlug)])
  type Row = { _id?: string; publicId?: string; archivedAt?: unknown; jobTitle?: unknown; photoUrl?: unknown; firstName?: unknown; lastName?: unknown; displayName?: unknown }
  const byId = new Map<string, { draft?: Row; published?: Row }>()
  for (const row of (rows as Row[] | null) ?? []) {
    const isDraft = str(row._id).startsWith('drafts.')
    const id = isDraft ? str(row._id).slice('drafts.'.length) : str(row._id)
    const e = byId.get(id) ?? {}
    if (isDraft) e.draft = row
    else e.published = row
    byId.set(id, e)
  }
  const out: Array<{ publicId: string; name: string; photoUrl: string | null; jobTitle: string }> = []
  for (const e of byId.values()) {
    const row = (e.draft ?? e.published)!
    const base = (e.published ?? e.draft)!
    const publicId = str(row.publicId)
    if (!UUID_RE.test(publicId) || base.archivedAt) continue
    const name = personDisplayName(row)
    const titles = localized(row.jobTitle)
    const jobTitle = firstOf(titles, site.defaultLocale)
    if (q && !q.split(/\s+/).every((w) => `${name} ${jobTitle}`.toLowerCase().includes(w))) continue
    out.push({ publicId, name, photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null, jobTitle })
    if (out.length >= limit) break
  }
  return out
}

// ── Classes ───────────────────────────────────────────────────────────────────

export type SaveClassInput = {
  /** null = a new class. */
  seriesId: string | null
  /** The course's permanent publicId. */
  courseId: string
  editionId?: string | null
  /** How it repeats (a preset). */
  repeat?: ClassRule
  /** Legacy: weekly on ONE weekday; used only when `repeat` is omitted. */
  weekday?: number
  interval?: number
  startTime: string
  endTime?: string | null
  /** The first class: must be a date the repeat produces. */
  startsOn: string
  /** The last class (optional; empty = until the term ends): must be a date the repeat produces. Ignored for "once". */
  endsOn?: string | null
  /** '' = no place; `location:<key>` or `venue:<publicId>`. */
  placeToken: string
  attendanceMode: AttendanceMode
  instructorPublicIds?: string[]
  languages?: string[]
  meetingRoomId?: string | null
  /** null when creating. */
  expectedVersion: number | null
  /** The zone the dashboard worked in; used only when the site has none. */
  timeZone?: string
}

/** Creates or updates a weekly class and regenerates its dates. courses.schedule.write. */
export async function saveClass(ctx: TenantAuthorizationContext, projectId: string, input: SaveClassInput, deps: CourseScheduleDeps = {}): Promise<SaveClassResult> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  assertUuid(input?.courseId, 'course')
  if (input.seriesId !== null) assertUuid(input.seriesId, 'class')
  assertTime(input.startTime, 'start time')
  if (input.endTime != null) assertTime(input.endTime, 'end time')
  assertDay(input.startsOn, 'first date')
  if (input.endsOn != null) assertDay(input.endsOn, 'last date')
  const repeat = input.repeat === undefined ? undefined : coerceClassRule(input.repeat) // a request body: only a preset gets through
  if (input.repeat !== undefined && !repeat) throw invalid('The repeat is not valid.')
  const store = storeOf(deps)
  const courseId = input.courseId.toLowerCase()
  // An existing class must be THIS course's, in this project.
  const existing = input.seriesId === null ? null : await seriesOf(store, projectId, input.seriesId, courseId)
  const site = await readSite(deps, grant.projectSlug)
  let editionZone: string | null = null
  if (input.editionId != null) {
    assertUuid(input.editionId, 'term')
    const edition = (await guarded(() => store.listEditions(projectId, { ownerType: null }))).find((e) => e.id === input.editionId)
    if (!edition) throw invalid('Unknown term.')
    editionZone = edition.timeZone
  }
  const languages = (input.languages ?? []).map((l) => l.toLowerCase()) // the store checks the shape (two letters, at most six)
  const saved = await guarded(() =>
    saveClassGuarded(
      grant.projectSlug,
      {
        projectId,
        seriesId: input.seriesId,
        ownerType: 'course',
        ownerPublicId: courseId,
        editionId: input.editionId ?? null,
        timeZone: existing?.timeZone ?? editionZone ?? zoneFor(site, input.timeZone),
        repeat: repeat ?? undefined,
        weekday: input.weekday,
        interval: input.interval ?? 1,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        place: placeOf(input.placeToken),
        attendanceMode: input.attendanceMode,
        instructorPublicIds: input.instructorPublicIds ?? [],
        languages,
        meetingRoomId: input.meetingRoomId ?? null,
        expectedVersion: input.expectedVersion,
        actorId: ctx.userId,
      },
      guardDeps(deps)
    )
  )
  return { seriesId: saved.seriesId, version: saved.version, truncated: saved.sync.truncated, keptEdited: saved.sync.modifiedOutsideRule.length }
}

/** Ends a class: it and its future dates go, past dates stay. courses.schedule.write. */
export async function endClass(ctx: TenantAuthorizationContext, projectId: string, input: { seriesId: string; expectedVersion: number }, deps: CourseScheduleDeps = {}): Promise<{ removed: number }> {
  grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  const store = storeOf(deps)
  const series = await seriesOf(store, projectId, input?.seriesId)
  if (!Number.isInteger(input.expectedVersion)) throw invalid('The version is required.')
  return { removed: await guarded(() => endClassGuarded(projectId, series.id, input.expectedVersion, { store })) }
}

export type UpdateOccurrenceRequest = {
  seriesId: string
  occurrenceId: string
  expectedVersion: number
  /** Cancel / restore. */
  cancelled?: boolean
  /** Substitute teachers for this date ([] = nobody). */
  instructorPublicIds?: string[]
  /** Back to the class's own teachers. */
  clearInstructors?: boolean
  /** A new time (and day) for this date. */
  time?: { date: string; startTime: string; endTime: string | null }
  /** A short note per site language. */
  note?: Record<string, string>
  clearNote?: boolean
}

/** Cancel / restore, substitute, change the time or add a note to ONE date. courses.schedule.write. Returns the new version. */
export async function updateOccurrence(ctx: TenantAuthorizationContext, projectId: string, input: UpdateOccurrenceRequest, deps: CourseScheduleDeps = {}): Promise<{ version: number }> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  assertUuid(input?.occurrenceId, 'date')
  if (!Number.isInteger(input.expectedVersion)) throw invalid('The version is required.')
  const store = storeOf(deps)
  const series = await seriesOf(store, projectId, input.seriesId)
  let times: { timeZone: string; startLocal: string; endLocal: string | null } | undefined
  if (input.time) {
    assertDay(input.time.date, 'date')
    assertTime(input.time.startTime, 'start time')
    if (input.time.endTime != null) assertTime(input.time.endTime, 'end time')
    times = { timeZone: series.timeZone, startLocal: `${input.time.date}T${input.time.startTime}`, endLocal: input.time.endTime ? `${input.time.date}T${input.time.endTime}` : null }
  }
  let note: Record<string, string> | undefined
  if (input.note !== undefined) note = cleanTexts(input.note, await readSite(deps, grant.projectSlug), SCHEDULE_LIMITS.noteLength, 'note')
  const version = await guarded(() =>
    updateOccurrenceGuarded(
      grant.projectSlug,
      {
        projectId,
        occurrenceId: input.occurrenceId,
        expectedVersion: input.expectedVersion,
        ...(input.cancelled !== undefined && { status: input.cancelled ? ('cancelled' as const) : ('scheduled' as const) }),
        ...(input.instructorPublicIds !== undefined && { instructorPublicIds: input.instructorPublicIds }),
        ...(input.clearInstructors && { clearInstructors: true }),
        ...(times && { times }),
        ...(note !== undefined && { note }),
        ...(input.clearNote && { clearNote: true }),
      },
      guardDeps(deps)
    )
  )
  return { version }
}

// ── Terms (editions) ──────────────────────────────────────────────────────────

/** The site's terms, earliest first. courses.course.read. */
export async function listEditions(ctx: TenantAuthorizationContext, projectId: string, deps: CourseScheduleDeps = {}): Promise<EditionView[]> {
  grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  return (await guarded(() => storeOf(deps).listEditions(projectId, { ownerType: null }))).map(editionView)
}

/** Creates or edits a term of the whole timetable (label per language, first and last day). courses.schedule.write. */
export async function saveEdition(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id?: string | null; label: Record<string, string>; startsOn: string; endsOn: string; expectedVersion?: number | null; timeZone?: string },
  deps: CourseScheduleDeps = {}
): Promise<{ id: string; version: number }> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  if (input?.id != null) assertUuid(input.id, 'term')
  assertDay(input?.startsOn, 'start date')
  assertDay(input.endsOn, 'end date')
  const site = await readSite(deps, grant.projectSlug)
  const label = cleanTexts(input.label, site, SCHEDULE_LIMITS.labelLength, 'name')
  if (!label[site.defaultLocale]) throw new CourseError('missing_title', 'A name in the main language is required.')
  return guarded(() =>
    saveEditionGuarded(
      grant.projectSlug,
      { projectId, id: input.id ?? null, ownerType: null, ownerPublicId: null, label, startsOn: input.startsOn, endsOn: input.endsOn, timeZone: zoneFor(site, input.timeZone), expectedVersion: input.expectedVersion ?? null },
      guardDeps(deps)
    )
  )
}

/** Removes a term that has no classes. courses.schedule.write. */
export async function removeEdition(ctx: TenantAuthorizationContext, projectId: string, input: { id: string; expectedVersion: number }, deps: CourseScheduleDeps = {}): Promise<void> {
  grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  assertUuid(input?.id, 'term')
  if (!Number.isInteger(input.expectedVersion)) throw invalid('The version is required.')
  const store = storeOf(deps)
  if ((await guarded(() => store.listSeries(projectId, { editionId: input.id }))).length) throw new CourseError('in_use', 'This term still has classes.')
  await guarded(() => store.removeEdition(projectId, input.id, input.expectedVersion))
}

// ── Holidays (closures) ───────────────────────────────────────────────────────

/** Holidays of the whole timetable, earliest first (a term id adds nothing: holidays apply to every term). courses.course.read. */
export async function listClosures(ctx: TenantAuthorizationContext, projectId: string, input: { editionId?: string | null } = {}, deps: CourseScheduleDeps = {}): Promise<ClosureView[]> {
  grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  if (input?.editionId != null) assertUuid(input.editionId, 'term')
  const rows = await guarded(() => storeOf(deps).listClosures(projectId, input?.editionId === undefined ? {} : { editionId: input.editionId }))
  return rows.map((c) => ({ id: c.id, editionId: c.editionId, startsOn: c.startsOn, endsOn: c.endsOn, label: c.label }))
}

/** Adds or changes a holiday; the classes it touches are regenerated. courses.schedule.write. */
export async function saveClosure(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id?: string | null; editionId?: string | null; startsOn: string; endsOn: string; label: Record<string, string> },
  deps: CourseScheduleDeps = {}
): Promise<{ id: string; resynced: number }> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  if (input?.id != null) assertUuid(input.id, 'holiday')
  if (input?.editionId != null) assertUuid(input.editionId, 'term')
  assertDay(input?.startsOn, 'start date')
  assertDay(input.endsOn, 'end date')
  const site = await readSite(deps, grant.projectSlug)
  const label = cleanTexts(input.label, site, SCHEDULE_LIMITS.labelLength, 'name')
  if (!label[site.defaultLocale]) throw new CourseError('missing_title', 'A name in the main language is required.')
  const store = storeOf(deps)
  if (input.editionId != null) {
    // A term of this project only (the store's foreign key says the same; this makes the refusal opaque).
    if (!(await guarded(() => store.listEditions(projectId, { ownerType: null }))).some((e) => e.id === input.editionId)) throw invalid('Unknown term.')
  }
  return guarded(() => store.saveClosure({ projectId, id: input.id ?? null, editionId: input.editionId ?? null, startsOn: input.startsOn, endsOn: input.endsOn, label }))
}

/** Removes a holiday; the classes it touched are regenerated. courses.schedule.write. */
export async function removeClosure(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: CourseScheduleDeps = {}): Promise<{ resynced: number }> {
  grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  assertUuid(input?.id, 'holiday')
  return guarded(() => storeOf(deps).removeClosure(projectId, input.id))
}

// ── Online rooms ──────────────────────────────────────────────────────────────

/** The rooms: label for everyone with read access, the details only with courses.meeting.manage. */
export async function listMeetingRooms(ctx: TenantAuthorizationContext, projectId: string, deps: CourseScheduleDeps = {}): Promise<{ rooms: RoomView[]; canManage: boolean }> {
  const grant = grantFor(ctx, projectId, COURSE_READ_PERMISSION)
  const manage = grant.permissions.includes(MEETING_MANAGE_PERMISSION)
  const rooms = await guarded(() => storeOf(deps).listMeetingRooms(projectId))
  return { rooms: rooms.map((r) => roomView(r, manage)), canManage: manage }
}

/** Creates or edits a room. courses.meeting.manage (owner). */
export async function saveMeetingRoom(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id?: string | null; label: string; joinUrl?: string | null; meetingId?: string | null; passcode?: string | null; expectedVersion?: number | null },
  deps: CourseScheduleDeps = {}
): Promise<{ id: string; version: number }> {
  grantFor(ctx, projectId, MEETING_MANAGE_PERMISSION)
  if (input?.id != null) assertUuid(input.id, 'room')
  return guarded(() =>
    storeOf(deps).saveMeetingRoom({
      projectId,
      id: input.id ?? null,
      label: input.label,
      joinUrl: input.joinUrl ?? null,
      meetingId: input.meetingId ?? null,
      passcode: input.passcode ?? null,
      expectedVersion: input.expectedVersion ?? null,
    })
  )
}

/** Removes a room that no class uses. courses.meeting.manage (owner). */
export async function removeMeetingRoom(ctx: TenantAuthorizationContext, projectId: string, input: { id: string; expectedVersion: number }, deps: CourseScheduleDeps = {}): Promise<void> {
  grantFor(ctx, projectId, MEETING_MANAGE_PERMISSION)
  assertUuid(input?.id, 'room')
  if (!Number.isInteger(input.expectedVersion)) throw invalid('The version is required.')
  const store = storeOf(deps)
  if ((await guarded(() => store.listSeries(projectId))).some((s) => s.meetingRoomId === input.id)) throw new CourseError('in_use', 'This room is still used by classes.')
  await guarded(() => store.removeMeetingRoom(projectId, input.id, input.expectedVersion))
}

// ── Hooks for the Courses list and the lifecycle ──────────────────────────────

/**
 * `CourseDeps.scheduleSummary` / `hasSchedule` backed by the course store, for
 * one project (the slug comes from the grant). The list shows classes, teachers
 * and the next class; delete is refused while a course has a live class.
 */
export function courseScheduleDeps(projectSlug: string, deps: CourseScheduleDeps = {}) {
  const store = () => storeOf(deps)
  return {
    hasSchedule: async (publicId: string, projectId: string): Promise<boolean> => {
      if (!UUID_RE.test(publicId)) return false
      return (await store().listSeries(projectId, { ownerPublicIds: [publicId.toLowerCase()] })).length > 0
    },
    scheduleSummary: async (projectId: string, publicIds: string[]): Promise<Map<string, CourseScheduleSummary> | null> => {
      const ids = publicIds.filter((x) => UUID_RE.test(x)).map((x) => x.toLowerCase())
      if (!ids.length) return new Map()
      const [series, next] = await Promise.all([
        store().listSeries(projectId, { ownerPublicIds: ids }),
        store().occurrencesInWindow(projectId, { from: (deps.now ?? (() => new Date()))().toISOString(), ownerPublicIds: ids, limit: 1000 }),
      ])
      const names = await readPeople(deps, projectSlug, series.flatMap((s) => s.instructorPublicIds))
      const out = new Map<string, CourseScheduleSummary>()
      for (const id of ids) {
        const mine = series.filter((s) => s.ownerPublicId.toLowerCase() === id)
        const teachers = [...new Set(mine.flatMap((s) => s.instructorPublicIds).map((p) => names.get(p.toLowerCase()) ?? ''))].filter(Boolean)
        const first = next.find((o) => o.ownerPublicId.toLowerCase() === id && o.status === 'scheduled')
        out.set(id, { classes: mine.length, teachers, nextClassAt: first?.startsAt ?? null })
      }
      return out
    },
  }
}
