/**
 * Client dashboard — Testimonials (ADR-048).
 *
 * Edits go to a DRAFT (`drafts.<id>`); only "Publish" changes the website.
 * Same enforcement as faq-sets / persons / the lifecycle service:
 *   1. `assertModuleAction(ctx, projectId, testimonials.*)` before any I/O;
 *      identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `testimonial`s of the grant's project — anything
 *      else is "not_found", so ids cannot be probed.
 *   3. Patch allow-list; every value is validated and rebuilt server-side.
 *   4. `assertSingleSanityProject` right before every mutation; revision guards
 *      (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (TestimonialErrorCode).
 *   6. PUBLISH IS REFUSED unless `permissionToPublish` is ticked (ADR-048 D1):
 *      `TestimonialError('permission_required')` with `detail.field ===
 *      'permissionToPublish'`. The website query repeats the rule.
 *   7. Unpublish / back online / archive / restore / delete go through the one
 *      lifecycle service (testimonials-lifecycle.ts). Permanent delete is
 *      owner-only and also removes the private row (Supabase).
 *   8. The private half (full name, email, phone, note) is only reachable
 *      through getTestimonialPrivate / saveTestimonialPrivate, which need
 *      testimonials.private.read.
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
import { deriveStatus, type LifecycleStatus } from '@/lib/lifecycle/status'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { hashText, type TranslationMeta } from '@/lib/translate/status'
import { isTranslationProviderId } from '@/lib/translate/types'
import {
  TESTIMONIALS_MODULE_ID,
  TESTIMONIAL_LIMITS,
  TESTIMONIAL_LOCALIZED_FIELDS,
  type TestimonialLocalizedField,
  TESTIMONIAL_RATING,
  TESTIMONIAL_SOURCES,
  TESTIMONIAL_TAG_KIND,
  TESTIMONIAL_TYPE,
  type TestimonialSource,
} from '@/lib/modules/testimonials/model'
import {
  PERMISSION_FIELD,
  TESTIMONIAL_DELETE_PERMISSION,
  TESTIMONIAL_LIFECYCLE,
  TESTIMONIAL_PRIVATE_READ_PERMISSION,
  TESTIMONIAL_READ_PERMISSION,
  TESTIMONIAL_WRITE_PERMISSION,
  TestimonialError,
  isTestimonialId,
  type TestimonialErrorCode,
} from '@/lib/api/testimonials-lifecycle'
import {
  TESTIMONIAL_PRIVATE_LIMITS,
  createSupabaseTestimonialPrivateStore,
  type TestimonialPrivateRead,
  type TestimonialPrivateRow,
  type TestimonialPrivateStore,
  type TestimonialPrivateWrite,
} from '@/lib/api/testimonials-private'

export {
  PERMISSION_FIELD,
  TESTIMONIAL_DELETE_PERMISSION,
  TESTIMONIAL_PRIVATE_READ_PERMISSION,
  TESTIMONIAL_READ_PERMISSION,
  TESTIMONIAL_WRITE_PERMISSION,
  TestimonialError,
  isTestimonialId,
}
export type { TestimonialErrorCode, TestimonialPrivateRead, TestimonialPrivateRow, TestimonialPrivateWrite }

export type TestimonialState = LifecycleStatus
/** languages[0] = the default language. */
export interface TestimonialSite {
  defaultLocale: string
  languages: string[]
}

export interface TestimonialListItem {
  /** Sanity document id (no `drafts.` prefix). */
  id: string
  publicId: string
  /** The name as shown ('' when anonymous or empty). */
  displayName: string
  anonymous: boolean
  /** A short text in the best language (abstract, else the start of the body). */
  excerpt: string
  rating: number | null
  featured: boolean
  permissionToPublish: boolean
  source: TestimonialSource
  givenOn: string | null
  tags: string[]
  originalLocale: string | null
  /** Languages the full text exists in (the list marks the site languages missing from it). */
  bodyLocales: string[]
  status: TestimonialState
  /** A draft exists next to the published version. */
  hasChanges: boolean
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  updatedAt: string
  createdAt: string
  /** Lower-cased name + every text in every language (client-side search). */
  searchText: string
}

export interface TestimonialSnapshot {
  id: string
  publicId: string
  /** The draft's revision; '' when no draft exists (call openTestimonialForEdit). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  status: TestimonialState
  hasChanges: boolean
  displayName: string
  anonymous: boolean
  context: Record<string, string>
  age: number | null
  abstract: Record<string, string>
  body: Record<string, string>
  /** Stored translation status per text field and language (machine / reviewed). */
  translations: Record<TestimonialLocalizedField, Record<string, TranslationMeta>>
  originalLocale: string | null
  rating: number | null
  givenOn: string | null
  source: TestimonialSource
  sourceUrl: string
  tags: string[]
  permissionToPublish: boolean
  featured: boolean
  live: { rev: string } | null
  site: TestimonialSite
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type TestimonialDeps = {
  client?: Client
  now?: () => Date
  /** New ids (document id, then publicId). */
  uuid?: () => string
  audit?: ContentAuditWriter
  read?: typeof readContentActivity
  /** The Supabase private store (tests inject a fake). */
  privateStore?: TestimonialPrivateStore
}

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields never copied between versions: publishing can never take a testimonial off the website. */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const TAG_KEY = /^[A-Za-z0-9_-]{1,64}$/
const RAW = { perspective: 'raw' } as const
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const RESOLVED_FIELDS = TESTIMONIAL_LOCALIZED_FIELDS

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new TestimonialError('not_found', 'Unknown testimonial.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === TESTIMONIAL_TYPE && doc.projectSlug === projectSlug)
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
    if ((error as { statusCode?: number })?.statusCode === 409) throw new TestimonialError('conflict', 'This testimonial was changed elsewhere.')
    throw new TestimonialError('failed', 'Could not save.')
  }
}

const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The per-language strings of a localized value (never `_type`, never `translationStatus`). */
function localized(value: unknown): Record<string, string> {
  const o = objectOf(value)
  if (!o) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

const HASH = /^[0-9a-f]{8}$/

/** The stored `translationStatus` of one localized field, reduced to well-formed entries (ADR-023 §4). */
export function translationMetaOf(value: unknown): Record<string, TranslationMeta> {
  const map = objectOf(objectOf(value)?.translationStatus)
  const out: Record<string, TranslationMeta> = {}
  for (const [loc, raw] of Object.entries(map ?? {})) {
    const m = objectOf(raw)
    if (!m || !LOCALE_KEY.test(loc) || (m.status !== 'machine' && m.status !== 'reviewed')) continue
    out[loc] = {
      status: m.status,
      ...(isTranslationProviderId(m.provider) && { provider: m.provider }),
      ...(typeof m.sourceLocale === 'string' && { sourceLocale: m.sourceLocale }),
      ...(typeof m.translatedAt === 'string' && { translatedAt: m.translatedAt }),
      ...(typeof m.textHash === 'string' && { textHash: m.textHash }),
      ...(typeof m.sourceHash === 'string' && { sourceHash: m.sourceHash }),
    }
  }
  return out
}

function cleanTranslationMeta(value: unknown): TranslationMeta | null {
  if (value === null) return null
  const m = objectOf(value)
  if (!m || (m.status !== 'machine' && m.status !== 'reviewed')) throw new TestimonialError('invalid_value', 'Unknown translation status.')
  const hash = (v: unknown) => (typeof v === 'string' && HASH.test(v) ? v : undefined)
  const when = typeof m.translatedAt === 'string' && !Number.isNaN(Date.parse(m.translatedAt)) ? new Date(m.translatedAt).toISOString() : undefined
  return {
    status: m.status,
    ...(isTranslationProviderId(m.provider) && { provider: m.provider }),
    ...(typeof m.sourceLocale === 'string' && LOCALE_KEY.test(m.sourceLocale) && { sourceLocale: m.sourceLocale }),
    ...(when && { translatedAt: when }),
    ...(hash(m.textHash) && { textHash: hash(m.textHash) }),
    ...(hash(m.sourceHash) && { sourceHash: hash(m.sourceHash) }),
  }
}

const pickText = (value: unknown, preferred: readonly string[]): string => {
  const v = localized(value)
  for (const l of preferred) if (v[l]) return v[l]
  return Object.values(v)[0] ?? ''
}

const archivedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.archivedAt === 'string' && doc.archivedAt ? doc.archivedAt : null)
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sourceOf = (v: unknown): TestimonialSource => ((TESTIMONIAL_SOURCES as readonly string[]).includes(v as string) ? (v as TestimonialSource) : 'other')
const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && TAG_KEY.test(t)) : [])

/** The site's languages (languages[0] = default). Exported for create-from-submission. */
export async function readTestimonialSite(client: Pick<Client, 'fetch'>, projectSlug: string): Promise<TestimonialSite> {
  return readSite(client as Client, projectSlug)
}

async function readSite(client: Client, projectSlug: string): Promise<TestimonialSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new TestimonialError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

const stateOf = (published: Doc | undefined, draft: Doc | undefined, now: Date) =>
  deriveStatus({ published: snapshotOf(published), draft, rule: 'optional' }, now)

function publicIdOf(doc: Doc | undefined): string {
  return typeof doc?.publicId === 'string' && UUID_RE.test(doc.publicId) ? doc.publicId : ''
}

// ── Private store plumbing ────────────────────────────────────────────────────

const storeOf = (deps: { privateStore?: TestimonialPrivateStore }) => deps.privateStore ?? createSupabaseTestimonialPrivateStore()

/**
 * Records WHEN permission to publish was given (GDPR evidence) next to the
 * private details. Best effort: a missing table or a conflict never blocks the
 * editor. Ticking sets the date once; unticking clears it.
 */
async function stampPermission(store: TestimonialPrivateStore, projectId: string, publicId: string, given: boolean, now: Date): Promise<void> {
  if (!publicId) return
  try {
    const current = await store.read(projectId, publicId)
    if (!current.available) return
    if (given) {
      if (current.row?.permissionGivenAt) return
      await store.save(projectId, publicId, { permissionGivenAt: now.toISOString() }, current.row ? current.row.version : null)
    } else if (current.row?.permissionGivenAt) {
      await store.save(projectId, publicId, { permissionGivenAt: null }, current.row.version)
    }
  } catch {
    /* best effort */
  }
}

/** Removes the private row of a deleted testimonial; one retry, then a tagged log line (never silent). */
async function removePrivate(store: TestimonialPrivateStore, projectId: string, publicId: string): Promise<void> {
  if (!publicId) return
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.remove(projectId, publicId)
      return
    } catch {
      /* retry */
    }
  }
  console.error(`[testimonials] private row not removed after delete: project=${projectId} publicId=${publicId}`)
  throw new TestimonialError('failed', 'The testimonial was deleted, but its private details could not be removed. Try again.')
}

// ── List ──────────────────────────────────────────────────────────────────────

type ListRow = Doc & {
  displayName?: unknown
  anonymous?: unknown
  rating?: unknown
  featured?: unknown
  permissionToPublish?: unknown
  source?: unknown
  givenOn?: unknown
  tags?: unknown
  originalLocale?: unknown
  context?: unknown
  abstract?: unknown
  body?: unknown
  _createdAt?: string
  _updatedAt?: string
}

const LIST_QUERY = `*[_type == "testimonial" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
  | order(_updatedAt desc)[0...${TESTIMONIAL_LIMITS.testimonials * 2}]{
    _id, _createdAt, _updatedAt, publicId, displayName, anonymous, rating, featured, permissionToPublish, source, givenOn, tags,
    originalLocale, archivedAt, expiresAt, publishedAt, context, abstract, body }`

function excerptOf(row: ListRow, site: TestimonialSite): string {
  const order = [...new Set([site.defaultLocale, str(row.originalLocale), 'en', ...site.languages].filter(Boolean))]
  const text = pickText(row.abstract, order) || pickText(row.body, order)
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? `${flat.slice(0, 199).trimEnd()}…` : flat
}

/** This project's testimonials, most recently changed first. Read permission. */
export async function listTestimonials(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: TestimonialDeps = {}
): Promise<{ testimonials: TestimonialListItem[]; site: TestimonialSite }> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const now = (deps.now ?? (() => new Date()))()
  const site = await readSite(client, grant.projectSlug)
  const rows = await client.fetch<ListRow[] | null>(LIST_QUERY, { projectSlug: grant.projectSlug }, RAW)
  const byId = new Map<string, { draft?: ListRow; published?: ListRow; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = row._id!.startsWith('drafts.')
    const id = isDraft ? row._id!.slice('drafts.'.length) : row._id!
    if (!isTestimonialId(id)) continue
    const entry = byId.get(id) ?? { createdAt: '' }
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  const testimonials = [...byId].map(([id, e]) => {
    const row = (e.draft ?? e.published)!
    const state = stateOf(e.published, e.draft, now)
    const anonymous = row.anonymous === true
    const displayName = anonymous ? '' : str(row.displayName).trim()
    const texts = RESOLVED_FIELDS.flatMap((f) => Object.values(localized(row[f])))
    return {
      id,
      publicId: publicIdOf(row),
      displayName,
      anonymous,
      excerpt: excerptOf(row, site),
      rating: numberOrNull(row.rating),
      featured: row.featured === true,
      permissionToPublish: row.permissionToPublish === true,
      source: sourceOf(row.source),
      givenOn: typeof row.givenOn === 'string' && row.givenOn ? row.givenOn : null,
      tags: tagsOf(row.tags),
      originalLocale: typeof row.originalLocale === 'string' && row.originalLocale ? row.originalLocale : null,
      bodyLocales: Object.keys(localized(row.body)),
      status: state.status,
      hasChanges: state.hasChanges,
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt: archivedAtOf(e.published ?? e.draft),
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
      searchText: [str(row.displayName), ...texts].join(' ').toLowerCase(),
    } satisfies TestimonialListItem
  })
  testimonials.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { testimonials, site }
}

// ── Read one ──────────────────────────────────────────────────────────────────

/** The testimonial as the editor shows it: the draft when there is one, else the published version. */
export async function getTestimonial(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: TestimonialDeps = {}): Promise<TestimonialSnapshot> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isTestimonialId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  const state = stateOf(published, draft, (deps.now ?? (() => new Date()))())
  return {
    id,
    publicId: publicIdOf(doc),
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    archivedAt: archivedAtOf(published ?? draft),
    status: state.status,
    hasChanges: state.hasChanges,
    displayName: str(doc.displayName),
    anonymous: doc.anonymous === true,
    context: localized(doc.context),
    age: numberOrNull(doc.age),
    abstract: localized(doc.abstract),
    body: localized(doc.body),
    translations: { context: translationMetaOf(doc.context), abstract: translationMetaOf(doc.abstract), body: translationMetaOf(doc.body) },
    originalLocale: typeof doc.originalLocale === 'string' && doc.originalLocale ? doc.originalLocale : null,
    rating: numberOrNull(doc.rating),
    givenOn: typeof doc.givenOn === 'string' && doc.givenOn ? doc.givenOn : null,
    source: sourceOf(doc.source),
    sourceUrl: str(doc.sourceUrl),
    tags: tagsOf(doc.tags),
    permissionToPublish: doc.permissionToPublish === true,
    featured: doc.featured === true,
    live: published?._rev ? { rev: published._rev } : null,
    site,
  }
}

// ── Value cleaners (shared by create and save) ───────────────────────────────

function cleanLine(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw new TestimonialError('invalid_value', `${what} must be text.`)
  const t = value.trim().replace(/\s+/g, ' ')
  if (t.length > max) throw new TestimonialError('invalid_value', `${what} is too long.`)
  return t
}

function cleanParagraphs(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw new TestimonialError('invalid_value', `${what} must be text.`)
  const t = value.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (t.length > max) throw new TestimonialError('invalid_value', `${what} is too long.`)
  return t
}

function cleanBool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new TestimonialError('invalid_value', `${what} must be yes or no.`)
  return value
}

function cleanRating(value: unknown): number | null {
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < TESTIMONIAL_RATING.min || value > TESTIMONIAL_RATING.max) {
    throw new TestimonialError('invalid_value', `A rating is a whole number from ${TESTIMONIAL_RATING.min} to ${TESTIMONIAL_RATING.max}.`)
  }
  return value
}

function cleanAge(value: unknown): number | null {
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 120) throw new TestimonialError('invalid_value', 'An age is a whole number from 0 to 120.')
  return value
}

function cleanDate(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !DATE_ONLY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TestimonialError('invalid_value', 'A date looks like 2026-11-08.')
  return value
}

function cleanSource(value: unknown): TestimonialSource {
  if (!(TESTIMONIAL_SOURCES as readonly unknown[]).includes(value)) throw new TestimonialError('invalid_value', 'Unknown source.')
  return value as TestimonialSource
}

function cleanUrl(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > TESTIMONIAL_LIMITS.sourceUrl) throw new TestimonialError('invalid_value', 'The link is too long or not text.')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new TestimonialError('invalid_value', 'The link must start with https://.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TestimonialError('invalid_value', 'The link must start with https://.')
  return url.toString()
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new TestimonialError('invalid_value', 'A testimonial has up to 20 tags.')
  const out: string[] = []
  for (const t of value) {
    if (typeof t !== 'string' || !TAG_KEY.test(t)) throw new TestimonialError('invalid_value', 'Unknown tag.')
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function cleanLocale(value: unknown, allowed: ReadonlySet<string>): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !LOCALE_KEY.test(value) || !(allowed.has(value) || (LOCALE_CODES as readonly string[]).includes(value))) {
    throw new TestimonialError('invalid_value', 'Unknown language.')
  }
  return value
}

const TEXT_MAX = { context: TESTIMONIAL_LIMITS.context, abstract: TESTIMONIAL_LIMITS.abstract, body: TESTIMONIAL_LIMITS.body } as const
const TEXT_TYPE = { context: 'localizedString', abstract: 'localizedText', body: 'localizedText' } as const

function cleanText(field: keyof typeof TEXT_MAX, value: unknown): string {
  return field === 'context' ? cleanLine(value, TEXT_MAX.context, 'The context') : cleanParagraphs(value, TEXT_MAX[field], field === 'abstract' ? 'The short version' : 'The testimonial')
}

/** Tag keys must be terms of this project's Testimonials vocabulary. */
async function assertTagsExist(client: Client, projectSlug: string, keys: string[]) {
  if (!keys.length) return
  const found = await client.fetch<string[] | null>(
    `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == $module && kind == $kind && key in $keys].key`,
    { projectSlug, module: TESTIMONIALS_MODULE_ID, kind: TESTIMONIAL_TAG_KIND, keys }
  )
  const ok = new Set(Array.isArray(found) ? found : [])
  if (!keys.every((k) => ok.has(k))) throw new TestimonialError('invalid_value', 'Unknown tag.')
}

// ── Create / open ────────────────────────────────────────────────────────────

export interface TestimonialInitial {
  displayName?: string
  anonymous?: boolean
  /** Per language; at least one non-empty entry is needed to publish later. */
  body?: Record<string, string>
  context?: Record<string, string>
  originalLocale?: string
  rating?: number
  givenOn?: string
  source?: TestimonialSource
  permissionToPublish?: boolean
  /**
   * The private half, written with the draft (create-from-submission). Needs
   * testimonials.private.read. If it cannot be stored, the draft is removed
   * again and `private_unavailable` is thrown — a testimonial is never created
   * without the record of who gave it.
   */
  private?: TestimonialPrivateWrite
}

async function assertRoomForOneMore(client: Client, projectSlug: string) {
  const n = await client.fetch<number | null>(`count(*[_type == "testimonial" && projectSlug == $projectSlug && !(_id in path("versions.**"))])`, { projectSlug }, RAW)
  if ((typeof n === 'number' ? n : 0) >= TESTIMONIAL_LIMITS.testimonials * 2) throw new TestimonialError('too_large', 'This site has too many testimonials. Delete some first.')
}

/** A new, unpublished testimonial (draft only). Write permission. Permission to publish starts OFF unless the caller says otherwise. */
export async function createTestimonial(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: TestimonialInitial = {},
  deps: TestimonialDeps = {}
): Promise<{ id: string; publicId: string; rev: string }> {
  const newId = deps.uuid ?? randomUUID
  const id = newId()
  const publicId = newId()
  return audited({ ctx, projectId, contentType: TESTIMONIAL_TYPE, contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
    if (input?.private) assertModuleAction(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const now = (deps.now ?? (() => new Date()))()
    const site = await readSite(client, grant.projectSlug)
    const allowed = new Set(site.languages)
    await assertRoomForOneMore(client, grant.projectSlug)

    const doc: { _id: string; _type: string } & Record<string, unknown> = {
      _id: `drafts.${id}`,
      _type: TESTIMONIAL_TYPE,
      projectSlug: grant.projectSlug,
      publicId,
      permissionToPublish: false,
      anonymous: false,
      featured: false,
      source: 'website',
    }
    if (input?.displayName !== undefined) {
      const name = cleanLine(input.displayName, TESTIMONIAL_LIMITS.displayName, 'The name')
      if (name) doc.displayName = name
    }
    if (input?.anonymous !== undefined) doc.anonymous = cleanBool(input.anonymous, 'Anonymous')
    for (const field of ['body', 'context'] as const) {
      const given = input?.[field]
      if (given === undefined) continue
      const o = objectOf(given)
      if (!o) throw new TestimonialError('invalid_value', 'A text must be one value per language.')
      const out: Record<string, unknown> = { _type: TEXT_TYPE[field] }
      for (const [loc, v] of Object.entries(o)) {
        if (!allowed.has(loc) && !(LOCALE_CODES as readonly string[]).includes(loc)) throw new TestimonialError('invalid_value', `Language "${loc}" is not on this site.`)
        const t = cleanText(field, v)
        if (t) out[loc] = t
      }
      if (Object.keys(out).length > 1) doc[field] = out
    }
    if (input?.originalLocale !== undefined) {
      const l = cleanLocale(input.originalLocale, allowed)
      if (l) doc.originalLocale = l
    }
    if (input?.rating !== undefined) {
      const r = cleanRating(input.rating)
      if (r !== null) doc.rating = r
    }
    if (input?.givenOn !== undefined) {
      const d = cleanDate(input.givenOn)
      if (d) doc.givenOn = d
    }
    if (input?.source !== undefined) doc.source = cleanSource(input.source)
    if (input?.permissionToPublish !== undefined) doc.permissionToPublish = cleanBool(input.permissionToPublish, 'Permission to publish')

    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined

    // The private half (create-from-submission) or the permission date.
    const store = storeOf(deps)
    if (input?.private) {
      const seed: TestimonialPrivateWrite = { ...input.private }
      if (doc.permissionToPublish === true && seed.permissionGivenAt === undefined) seed.permissionGivenAt = now.toISOString()
      try {
        await store.save(projectId, publicId, seed, null)
      } catch (error) {
        // Never a testimonial without the record of who gave it: take the draft back.
        try {
          await client.transaction().delete(`drafts.${id}`).commit()
        } catch {
          console.error(`[testimonials] draft ${id} not removed after its private row failed`)
        }
        throw error instanceof TestimonialError ? error : new TestimonialError('failed', 'Could not save the private details.')
      }
    } else if (doc.permissionToPublish === true) {
      await stampPermission(store, projectId, publicId, true, now)
    }
    return { value: { id, publicId, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published testimonial. A server action, never a GET. */
export async function openTestimonialForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: TestimonialDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const id = input?.id
  if (!isTestimonialId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (archivedAtOf(published)) throw new TestimonialError('archived', 'Restore this testimonial to edit it.')
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = TESTIMONIAL_TYPE
  copy.projectSlug = grant.projectSlug
  await singleProjectGuard(client, grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string }
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
      throw new TestimonialError('conflict', 'This testimonial was changed elsewhere.')
    }
    throw new TestimonialError('failed', 'Could not open the testimonial.')
  }
}

// ── Save (autosave) ──────────────────────────────────────────────────────────

const PLAIN_FIELDS = new Set(['displayName', 'anonymous', 'age', 'originalLocale', 'rating', 'givenOn', 'source', 'sourceUrl', 'tags', 'permissionToPublish', 'featured'])

/**
 * Validates and applies one autosave patch to `drafts.<id>`. Paths: the plain
 * fields above, and `context.<locale>` / `abstract.<locale>` / `body.<locale>`.
 * `null` or '' clears an optional field. Returns the new revision.
 */
export async function saveTestimonialDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: TestimonialDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isTestimonialId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new TestimonialError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new TestimonialError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > TESTIMONIAL_LIMITS.patchBytes) throw new TestimonialError('too_large', 'Too much at once.')
  // Field allow-list before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const plain = PLAIN_FIELDS.has(path)
    if (field === 'translation' && (RESOLVED_FIELDS as readonly string[]).includes(locale) && rest.length === 1 && LOCALE_KEY.test(rest[0])) continue
    const text = (RESOLVED_FIELDS as readonly string[]).includes(field) && !!locale && rest.length === 0
    if (!plain && !text) throw new TestimonialError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, TestimonialSite, void]>([
    readPair(client, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (draft!._rev !== input.rev) throw new TestimonialError('conflict', 'This testimonial was edited elsewhere.')
  if (archivedAtOf(published ?? draft)) throw new TestimonialError('archived', 'Restore this testimonial to edit it.')

  const allowedLocales = new Set(site.languages)
  for (const f of RESOLVED_FIELDS) for (const k of Object.keys(localized(draft![f]))) if (LOCALE_KEY.test(k)) allowedLocales.add(k)

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  const nestedEnsure: Record<string, unknown> = {}
  const textTouched: string[] = []
  let newTags: string[] = []
  let permission: boolean | undefined

  const metaPatches: Array<{ field: TestimonialLocalizedField; locale: string; meta: TranslationMeta | null }> = []
  for (const [path, value] of Object.entries(input.set)) {
    if (path.startsWith('translation.')) {
      const [, f, loc] = path.split('.')
      if (!allowedLocales.has(loc)) throw new TestimonialError('invalid_field', `Language "${loc}" is not on this site.`)
      metaPatches.push({ field: f as TestimonialLocalizedField, locale: loc, meta: cleanTranslationMeta(value) })
      continue
    }
    switch (path) {
      case 'displayName': {
        const t = cleanLine(value ?? '', TESTIMONIAL_LIMITS.displayName, 'The name')
        if (t) set.displayName = t
        else unset.push('displayName')
        break
      }
      case 'anonymous':
      case 'featured':
        set[path] = cleanBool(value, path === 'anonymous' ? 'Anonymous' : 'Featured')
        break
      case 'permissionToPublish':
        permission = cleanBool(value, 'Permission to publish')
        set.permissionToPublish = permission
        break
      case 'age': {
        const a = cleanAge(value)
        if (a === null) unset.push('age')
        else set.age = a
        break
      }
      case 'rating': {
        const r = cleanRating(value)
        if (r === null) unset.push('rating')
        else set.rating = r
        break
      }
      case 'givenOn': {
        const d = cleanDate(value)
        if (d === null) unset.push('givenOn')
        else set.givenOn = d
        break
      }
      case 'originalLocale': {
        const l = cleanLocale(value, allowedLocales)
        if (l === null) unset.push('originalLocale')
        else set.originalLocale = l
        break
      }
      case 'source':
        set.source = cleanSource(value)
        break
      case 'sourceUrl': {
        const u = cleanUrl(value)
        if (u === null) unset.push('sourceUrl')
        else set.sourceUrl = u
        break
      }
      case 'tags': {
        const tags = cleanTags(value)
        const stored = new Set(tagsOf(draft!.tags))
        newTags = tags.filter((t) => !stored.has(t))
        set.tags = tags
        break
      }
      default: {
        const [field, locale] = path.split('.') as [keyof typeof TEXT_MAX, string]
        if (!allowedLocales.has(locale)) throw new TestimonialError('invalid_field', `Language "${locale}" is not on this site.`)
        const t = cleanText(field, value ?? '')
        ensure[field] = { _type: TEXT_TYPE[field] }
        if (t) set[path] = t
        else unset.push(path)
        textTouched.push(path)
      }
    }
  }

  // Translation status (ADR-023 §4): a machine value whose text no longer matches
  // its hash was edited by a person → `reviewed`; a cleared value loses its status.
  const explicit = new Set(metaPatches.map((m) => `${m.field}.${m.locale}`))
  for (const { field, locale, meta } of metaPatches) {
    const key = `${field}.${locale}`
    const finalText = typeof set[key] === 'string' ? (set[key] as string) : unset.includes(key) ? '' : str(objectOf(draft![field])?.[locale])
    const statusPath = `${field}.translationStatus.${locale}`
    if (!meta || !finalText) {
      unset.push(statusPath)
      continue
    }
    let out: TranslationMeta = meta
    if (meta.status === 'machine' && meta.textHash) {
      const rawSent = input.set[key]
      if (typeof rawSent === 'string' && hashText(rawSent) === meta.textHash) out = { ...meta, textHash: hashText(finalText) }
      else if (hashText(finalText) !== meta.textHash) out = { ...meta, status: 'reviewed' }
    }
    set[statusPath] = { _type: 'translationMeta', ...out }
    nestedEnsure[`${field}.translationStatus`] = { _type: 'translationStatus' }
  }
  for (const path of textTouched) {
    if (explicit.has(path)) continue
    const [f, loc] = path.split('.')
    const stored = objectOf(objectOf(objectOf(draft![f])?.translationStatus)?.[loc])
    if (!stored) continue
    const statusPath = `${f}.translationStatus.${loc}`
    if (unset.includes(path)) unset.push(statusPath)
    else if (stored.status === 'machine' && typeof stored.textHash === 'string' && hashText(set[path] as string) !== stored.textHash) {
      set[statusPath] = { ...stored, _type: 'translationMeta', status: 'reviewed' }
      nestedEnsure[`${f}.translationStatus`] = { _type: 'translationStatus' }
    }
  }

  await assertTagsExist(client, grant.projectSlug, newTags)

  const result = (await commit(
    client,
    grant.projectSlug,
    () => {
      let p = client.patch(draftId).ifRevisionId(input.rev)
      if (Object.keys(ensure).length) p = p.setIfMissing(ensure)
      if (Object.keys(nestedEnsure).length) p = p.setIfMissing(nestedEnsure)
      if (Object.keys(set).length) p = p.set(set)
      if (unset.length) p = p.unset(unset)
      return p.commit(DRAFT_SAVE)
    },
    guard
  )) as { _rev?: string } | undefined

  if (permission !== undefined) await stampPermission(storeOf(deps), projectId, publicIdOf(draft), permission, (deps.now ?? (() => new Date()))())
  return { rev: result?._rev ?? '' }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

const hasBody = (doc: Doc) => Object.keys(localized(doc.body)).length > 0

/**
 * Publishes `drafts.<id>` in one revision-guarded transaction.
 * REFUSED unless `permissionToPublish` is ticked (`permission_required`,
 * `detail.field === 'permissionToPublish'`), and needs a text in some language.
 */
export async function publishTestimonialDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: TestimonialDeps = {}
): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: TESTIMONIAL_TYPE, contentId: isTestimonialId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isTestimonialId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new TestimonialError('conflict', 'Missing revision.')
      const { published, draft } = await readPair(client, input.id, grant.projectSlug)
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new TestimonialError('conflict', 'This testimonial was edited elsewhere.')
      if (archivedAtOf(published ?? draft)) throw new TestimonialError('archived', 'Restore this testimonial before publishing.')
      // ADR-048 D1 — nothing goes live without the person's permission.
      if (draft.permissionToPublish !== true) {
        throw new TestimonialError('permission_required', 'Tick “Permission to publish” before publishing.', { field: PERMISSION_FIELD })
      }
      if (!hasBody(draft)) throw new TestimonialError('invalid_value', 'Add the testimonial text before publishing.')

      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = TESTIMONIAL_TYPE
      doc.projectSlug = grant.projectSlug
      if (!publicIdOf(draft)) doc.publicId = (deps.uuid ?? randomUUID)()
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
      const now = (deps.now ?? (() => new Date()))()
      await stampPermission(storeOf(deps), projectId, String(doc.publicId), true, now)
      // Sanity sets a touched document's revision to the transaction id.
      return { value: { rev: transactionId }, action: lifecycleAction(snapshotOf(published), state, 'optional', now), state }
    }
  )
}

/** Throws away unpublished changes of a published testimonial. */
export async function discardTestimonialDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: TestimonialDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isTestimonialId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) throw new TestimonialError('invalid_value', 'This testimonial was never published.')
  if (draft._rev !== input.rev) throw new TestimonialError('conflict', 'This testimonial was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () => client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit())
}

// ── Unpublish / back online / archive / restore / delete ──────────────────────

export const TESTIMONIAL_LIFECYCLE_OPS = ['unpublish', 'backOnline', 'archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type TestimonialLifecycleOp = (typeof TESTIMONIAL_LIFECYCLE_OPS)[number]

/**
 * Unpublish / back online / archive / restore / delete through the lifecycle
 * service (ADR-032) with the testimonial descriptor. Returns the DRAFT's new
 * revision (null when there is no draft) so an open editor can adopt it.
 *
 *   unpublish          takes it off the website now (expiresAt = now)
 *   backOnline         puts it back; refused as `permission_required` when the
 *                      published version has no permission to publish
 *   archive / restore  archive implies unpublished; a restored testimonial
 *                      stays OFFLINE until backOnline / publish
 *   deleteDraft        a never-published draft (testimonials.write)
 *   deletePermanently  an ARCHIVED testimonial (testimonials.delete, owner)
 *
 * deleteDraft and deletePermanently also remove the private row.
 */
export async function runTestimonialLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: TestimonialLifecycleOp },
  deps: TestimonialDeps = {}
): Promise<{ rev: string | null }> {
  if (!(TESTIMONIAL_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new TestimonialError('invalid_value', 'Unknown action.')
  // Gate before any read (the service re-checks the exact permission set).
  const grant = grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  if (input.op === 'deletePermanently') grantFor(ctx, projectId, TESTIMONIAL_DELETE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  const d = TESTIMONIAL_LIFECYCLE
  if (!isTestimonialId(input.id)) notFound()
  const { published, draft } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
  // A document that exists nowhere answers like one of another project: ids cannot be probed.
  if (!published && !draft) notFound()
  const args = { id: input.id, rev: (input.op === 'deleteDraft' ? draft?._rev : published?._rev) ?? '' }
  const publicId = publicIdOf(published ?? draft)
  const store = storeOf(deps)
  switch (input.op) {
    case 'unpublish': {
      const r = await lifecycle.unpublishNow(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'backOnline': {
      if (published && published.permissionToPublish !== true) {
        throw new TestimonialError('permission_required', 'Tick “Permission to publish” before putting it back online.', { field: PERMISSION_FIELD })
      }
      await lifecycle.backOnline(d, ctx, projectId, args, sdeps)
      return { rev: null }
    }
    case 'archive': {
      const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'restore': {
      const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'deleteDraft':
      await lifecycle.deleteDraft(d, ctx, projectId, args, sdeps)
      await removePrivate(store, projectId, publicId)
      return { rev: null }
    case 'deletePermanently':
      await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
      await removePrivate(store, projectId, publicId)
      return { rev: null }
  }
}

const run = (op: TestimonialLifecycleOp) => (ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps?: TestimonialDeps) =>
  runTestimonialLifecycle(ctx, projectId, { id: input?.id, op }, deps)

export const unpublishTestimonial = run('unpublish')
export const backOnlineTestimonial = run('backOnline')
export const archiveTestimonial = run('archive')
export const restoreTestimonial = run('restore')
export const deleteTestimonialDraft = run('deleteDraft')
/** Owner only (testimonials.delete). Archived testimonials only. Also removes the private row. */
export const deleteTestimonialPermanently = run('deletePermanently')

// ── Activity ──────────────────────────────────────────────────────────────────

/** The testimonial's Activity (ADR-032 D9). Read permission; it must be this project's. */
export async function getTestimonialActivity(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: TestimonialDeps = {}
): Promise<ActivityItem[]> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isTestimonialId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  return (deps.read ?? readContentActivity)({ projectId, contentType: TESTIMONIAL_TYPE, contentIds: [input.id] })
}

// ── Private details (Supabase) ────────────────────────────────────────────────

async function publicIdFor(client: Client, id: string, projectSlug: string): Promise<string> {
  if (!isTestimonialId(id)) notFound()
  const { published, draft } = await readPair(client, id, projectSlug)
  const publicId = publicIdOf(draft ?? published)
  if (!publicId) notFound()
  return publicId
}

/** Who gave the testimonial. Needs testimonials.private.read. `{ available: false }` while migration 067 is not applied. */
export async function getTestimonialPrivate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: TestimonialDeps = {}
): Promise<TestimonialPrivateRead> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const publicId = await publicIdFor(client, input?.id, grant.projectSlug)
  return storeOf(deps).read(projectId, publicId)
}

function cleanPrivateText(value: unknown, max: number, what: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new TestimonialError('invalid_value', `${what} must be text.`)
  const t = value.trim()
  if (t.length > max) throw new TestimonialError('invalid_value', `${what} is too long.`)
  return t || null
}

/**
 * Saves the private details (full name, email, phone, note); fields left out
 * are kept. `version` is the one read (null = no row yet): a moved row is
 * `conflict`. Needs testimonials.private.read AND testimonials.write.
 */
export async function saveTestimonialPrivate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; version: number | null; set: { fullName?: string | null; email?: string | null; phone?: string | null; note?: string | null } },
  deps: TestimonialDeps = {}
): Promise<TestimonialPrivateRow> {
  const grant = grantFor(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
  grantFor(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const publicId = await publicIdFor(client, input?.id, grant.projectSlug)
  const set = objectOf(input.set)
  if (!set) throw new TestimonialError('invalid_value', 'Nothing to save.')
  const write: TestimonialPrivateWrite = {}
  for (const key of Object.keys(set)) {
    if (!['fullName', 'email', 'phone', 'note'].includes(key)) throw new TestimonialError('invalid_field', `Field "${key}" cannot be changed here.`)
  }
  if ('fullName' in set) write.fullName = cleanPrivateText(set.fullName, TESTIMONIAL_PRIVATE_LIMITS.fullName, 'The name')
  if ('phone' in set) write.phone = cleanPrivateText(set.phone, TESTIMONIAL_PRIVATE_LIMITS.phone, 'The phone number')
  if ('note' in set) write.note = cleanPrivateText(set.note, TESTIMONIAL_PRIVATE_LIMITS.note, 'The note')
  if ('email' in set) {
    const email = cleanPrivateText(set.email, TESTIMONIAL_PRIVATE_LIMITS.email, 'The email')
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TestimonialError('invalid_value', 'That does not look like an email address.')
    write.email = email
  }
  if (input.version !== null && (!Number.isInteger(input.version) || input.version < 1)) throw new TestimonialError('conflict', 'Missing version.')
  await singleProjectGuard(client, grant.projectSlug)
  return storeOf(deps).save(projectId, publicId, write, input.version)
}

/**
 * The real names behind a set of testimonials, for the list (only people who
 * may see them). Empty map when the caller lacks testimonials.private.read or
 * the table does not exist yet.
 */
export async function readTestimonialNames(
  ctx: TenantAuthorizationContext,
  projectId: string,
  publicIds: readonly string[],
  deps: Pick<TestimonialDeps, 'privateStore'> = {}
): Promise<Map<string, string>> {
  try {
    assertModuleAction(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
  } catch {
    return new Map()
  }
  const out = new Map<string, string>()
  const r = await storeOf(deps).readMany(projectId, publicIds)
  if (!r.available) return out
  for (const [id, row] of r.rows) if (row.fullName) out.set(id, row.fullName)
  return out
}
