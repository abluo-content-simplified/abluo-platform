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
 *   3. Patch allow-list (`title.<loc>`, `shortDescription.<loc>`, `color`);
 *      languages must be the site's (or already stored in the draft).
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
import { snapshotOf } from '@/lib/lifecycle/transition'
import { DEFAULT_COURSE_COLOR, isCourseColor, type CourseColor } from '@/lib/modules/courses/model'
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

export type CourseState = 'draft' | 'published' | 'changes' | 'archived'

/** languages[0] = the default language. */
export interface CourseSite {
  defaultLocale: string
  languages: string[]
}

/** What scheduling knows about a course; null per course (or overall) = not available yet. */
export interface CourseScheduleSummary {
  /** Weekly classes (live series). */
  classes: number
  /** Teacher names (People), in the site's default language. */
  teachers: string[]
  /** ISO instant of the next class, or null. */
  nextClassAt: string | null
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
  /** From scheduling; null while it is not available. */
  schedule: CourseScheduleSummary | null
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
  state: CourseState
  title: Record<string, string>
  shortDescription: Record<string, string>
  color: CourseColor
  site: CourseSite
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type CourseDeps = {
  client?: Client
  now?: () => Date
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
const colorOf = (v: unknown): CourseColor => (isCourseColor(v) ? v : DEFAULT_COURSE_COLOR)

function localized(value: unknown): Record<string, string> {
  const o = objectOf(value)
  if (!o) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

const firstOf = (map: Record<string, string>, defaultLocale: string): string => map[defaultLocale] ?? Object.values(map)[0] ?? ''

function stateOf(published: Doc | undefined, draft: Doc | undefined): CourseState {
  if (archivedAtOf(published ?? draft)) return 'archived'
  if (published && draft) return 'changes'
  return published ? 'published' : 'draft'
}

async function readSite(client: Client, projectSlug: string): Promise<CourseSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new CourseError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Exported so tests assert exactly what runs. Raw perspective: drafts and published. */
export const COURSE_LIST_QUERY = /* groq */ `*[_type == "course" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
      | order(_updatedAt desc)[0...${COURSE_LIMITS.courses * 2}]{
        _id, _createdAt, _updatedAt, publicId, title, shortDescription, color, archivedAt
      }`

type ListRow = Doc & { _createdAt?: string; _updatedAt?: string }

/** This project's courses, newest change first. Read permission. */
export async function listCourses(ctx: TenantAuthorizationContext, projectId: string, deps: CourseDeps = {}): Promise<{ courses: CourseListItem[]; site: CourseSite }> {
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
  let summaries: Map<string, CourseScheduleSummary> | null = null
  try {
    summaries = deps.scheduleSummary ? await deps.scheduleSummary(projectId, publicIds) : null
  } catch {
    summaries = null
  }
  const courses = [...byId].map(([id, e]): CourseListItem => {
    const row = (e.draft ?? e.published)!
    const base = (e.published ?? e.draft)!
    const titles = localized(row.title)
    const descriptions = localized(row.shortDescription)
    const publicId = str(row.publicId)
    const schedule = summaries?.get(publicId.toLowerCase()) ?? summaries?.get(publicId) ?? null
    const archivedAt = archivedAtOf(base)
    return {
      id,
      publicId,
      title: firstOf(titles, site.defaultLocale),
      shortDescription: firstOf(descriptions, site.defaultLocale),
      color: colorOf(row.color),
      state: archivedAt ? 'archived' : e.published && e.draft ? 'changes' : e.published ? 'published' : 'draft',
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt,
      schedule,
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
      searchText: [...Object.values(titles), ...Object.values(descriptions), ...(schedule?.teachers ?? [])].join(' ').toLowerCase(),
      missingLanguages: site.languages.filter((l) => l !== site.defaultLocale && !titles[l]),
    }
  })
  return { courses, site }
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
    state: stateOf(published, draft),
    title: localized(doc.title),
    shortDescription: localized(doc.shortDescription),
    color: colorOf(doc.color),
    site,
  }
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
export const COURSE_PATCH_FIELDS = ['title.<loc>', 'shortDescription.<loc>', 'color'] as const

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
    const ok = path === 'color' || ((LOCALIZED_FIELDS as readonly string[]).includes(field) && !!locale && LOCALE_KEY.test(locale) && rest.length === 0)
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
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(input.set)) {
    if (path === 'color') {
      if (!isCourseColor(value)) throw new CourseError('invalid_value', 'Unknown colour.')
      set.color = value
      continue
    }
    const [field, locale] = path.split('.') as [(typeof LOCALIZED_FIELDS)[number], string]
    if (!allowed.has(locale)) throw new CourseError('invalid_field', `Language "${locale}" is not on this site.`)
    ensure[field] = { _type: LOCALIZED_TYPE[field] }
    const t = cleanText(value, field === 'title' ? COURSE_LIMITS.title : COURSE_LIMITS.shortDescription, `"${path}"`, field === 'shortDescription')
    if (t) set[path] = t
    else unset.push(path)
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

/** Makes the draft the live course. Needs a title in the site's main language. Write permission. */
export async function publishCourseDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: CourseDeps = {}
): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: 'course', contentId: isCourseId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, COURSE_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isCourseId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new CourseError('conflict', 'Missing revision.')
      const [{ published, draft }, site] = await Promise.all([readPair(client, input.id, grant.projectSlug), readSite(client, grant.projectSlug)])
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new CourseError('conflict', 'This course was edited elsewhere.')
      if (archivedAtOf(published ?? draft)) throw new CourseError('archived', 'Restore this course before publishing.')
      if (!localized(draft.title)[site.defaultLocale]) throw new CourseError('missing_title', 'A title in the main language is required.')

      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = 'course'
      doc.projectSlug = grant.projectSlug
      // The publicId never changes once published (class schedules key on it).
      if (published && typeof published.publicId === 'string' && published.publicId) doc.publicId = published.publicId
      if (typeof doc.publicId !== 'string' || !UUID_RE.test(doc.publicId)) doc.publicId = (deps.publicUuid ?? randomUUID)()

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
      return { value: { rev: transactionId }, action: published ? null : ('published' as const), state }
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

export const COURSE_LIFECYCLE_OPS = ['archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type CourseLifecycleOp = (typeof COURSE_LIFECYCLE_OPS)[number]

/**
 * Archive / restore (courses.course.write) and delete (courses.course.delete)
 * through the lifecycle service. Delete is refused while anything references
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
        const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'restore': {
        const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        // A course has no publication window: restore puts it straight back
        // (the service leaves expiresAt = archive time, which means nothing
        // here; it is removed so no reader mistakes it for an end date).
        const raw = (deps.client ?? sanityWriteClient) as Client
        const tx = (await commit(raw, grant.projectSlug, () => {
          let t = raw.transaction().patch(input.id, { unset: ['expiresAt'] })
          if (draft) t = t.patch(`drafts.${input.id}`, { unset: ['expiresAt'] })
          return t.commit()
        })) as { transactionId?: string } | undefined
        return { rev: draft ? (tx?.transactionId ?? r.draftRev) : r.draftRev }
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
