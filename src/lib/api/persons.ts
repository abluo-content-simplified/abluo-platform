/**
 * Client dashboard — People (People module, ADR-043).
 *
 * Public profile edits go to a DRAFT (`drafts.<personId>`); only "Publish"
 * changes the website. Private details (private contacts, birthday, notes)
 * live in Supabase person_private (persons-private.ts) and are saved directly.
 * Same enforcement as faq-sets / gallery-drafts / the lifecycle service:
 *   1. `assertModuleAction(ctx, projectId, people.person.*)` before any I/O;
 *      identity (`_id`, `_type`, `projectSlug`, `publicId`) comes from the
 *      GRANT and the stored document, never from input.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `person`s of the grant's project — anything else
 *      is "not_found", so ids cannot be probed.
 *   3. Patch allow-list; arrays (contacts, qualifications, bio) are REBUILT
 *      server-side; bio is sanitized restricted rich text (the FAQ answer
 *      rules); NEW internal link references, photos and group keys must
 *      belong to this project.
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards → "conflict".
 *   5. Opaque error codes (PersonErrorCode).
 *   6. Archive / restore / delete go through the one lifecycle service
 *      (persons-lifecycle.ts); anonymise is its own audited operation.
 */
import { randomUUID } from 'crypto'
import type { PortableTextBlock } from '@portabletext/editor'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import { readContentActivity, type ActivityItem } from '@/lib/lifecycle/activity'
import * as lifecycle from '@/lib/lifecycle/service'
import { snapshotOf } from '@/lib/lifecycle/transition'
import { collectInternalRefs, FaqAnswerError, sanitizeFaqAnswer } from '@/lib/faq/answer-blocks'
import { BODY_LINK_TARGET_TYPES } from '@/lib/links/target-types'
import { isValidTermKey } from '@/lib/taxonomy/ids'
import { hashText, type TranslationMeta } from '@/lib/translate/status'
import { isTranslationProviderId } from '@/lib/translate/types'
import {
  DEFAULT_PERSON_VISIBILITY,
  PEOPLE_MODULE_ID,
  PEOPLE_GROUP_KIND,
  PERSON_CONTACT_KINDS,
  PERSON_VISIBILITIES,
  personDisplayName,
  type PersonContactKind,
  type PersonVisibility,
} from '@/lib/modules/people/model'
import {
  createScheduleUsage,
  isPersonId,
  PEOPLE_ANONYMISE_PERMISSION,
  PEOPLE_ARCHIVE_PERMISSION,
  PEOPLE_DELETE_PERMISSION,
  PEOPLE_READ_PERMISSION,
  PEOPLE_WRITE_PERMISSION,
  PersonError,
  personLifecycle,
  sanityPersonUsage,
  UUID_RE,
  type PersonErrorCode,
  type PersonUsage,
  type ScheduleUsageFn,
} from '@/lib/api/persons-lifecycle'
import { createSupabasePersonPrivateStore, type PersonPrivateContact, type PersonPrivateRow, type PersonPrivateStore } from '@/lib/api/persons-private'

export {
  PEOPLE_ANONYMISE_PERMISSION,
  PEOPLE_ARCHIVE_PERMISSION,
  PEOPLE_DELETE_PERMISSION,
  PEOPLE_READ_PERMISSION,
  PEOPLE_WRITE_PERMISSION,
  PersonError,
  isPersonId,
}
export type { PersonErrorCode, PersonUsage }

export const PERSON_LIMITS = {
  name: 80,
  displayName: 120,
  short: 120,
  shortBio: 600,
  website: 500,
  contactValue: 300,
  contactLabel: 80,
  contacts: 20,
  qualifications: 30,
  issuer: 200,
  languages: 20,
  groups: 20,
  notes: 5000,
  people: 1000,
  patchBytes: 500_000,
} as const

export type PersonState = 'draft' | 'published' | 'changes' | 'archived'

/** languages[0] = the default language. */
export interface PersonSite {
  defaultLocale: string
  languages: string[]
}

export interface PersonListItem {
  /** Sanity document id (base id). */
  id: string
  publicId: string
  firstName: string
  lastName: string
  displayName: string
  /** The display-name rule (displayName, else "first last"); '' when anonymised. */
  name: string
  /** Media Library image URL (no transformation), or null. */
  photoUrl: string | null
  groups: string[]
  /** In the site's default language. */
  jobTitle: string
  visibility: PersonVisibility
  state: PersonState
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  anonymised: boolean
  sortOrder: number | null
  /** Sanity references by kind; `sessions` null when the schedules could not be read. */
  usage: { pages: number; posts: number; events: number; sessions: number | null }
  updatedAt: string
  createdAt: string
  /** Lower-cased names, job titles (all languages) and group keys, for client-side search. */
  searchText: string
  /** What is still missing (list badge + "Missing…" filter); all empty/false for anonymised people. */
  missing: PersonMissing
}

/**
 * Completeness at a glance. `shortBio`: no short bio in the site's main
 * language. `languages`: the OTHER site languages in which a title or short
 * bio exists in the main language but not in that one (what a translation
 * still has to cover).
 */
export interface PersonMissing {
  photo: boolean
  shortBio: boolean
  languages: string[]
}

/** Pure: what a list row is missing (exported for tests). `row` is the draft ?? published list row. */
export function personMissing(row: { photoUrl?: unknown; jobTitle?: unknown; shortBio?: unknown }, site: PersonSite, anonymised: boolean): PersonMissing {
  if (anonymised) return { photo: false, shortBio: false, languages: [] }
  const titles = localized(row.jobTitle)
  const bios = localized(row.shortBio)
  const def = site.defaultLocale
  const languages = site.languages.filter((l) => l !== def && ((Boolean(titles[def]) && !titles[l]) || (Boolean(bios[def]) && !bios[l])))
  return { photo: typeof row.photoUrl !== 'string' || !row.photoUrl, shortBio: !bios[def], languages }
}

export interface PersonContactValue {
  _key: string
  kind: PersonContactKind
  value: string
  label: string
  preferred: boolean
  /** Where it is stored: public = Sanity (website), private = Supabase (never on the website). */
  visibility: 'public' | 'private'
}

export interface PersonQualificationValue {
  _key: string
  title: Record<string, string>
  issuer: string
  issuedOn: string | null
  expiresOn: string | null
}

export type PersonPrivateSection =
  | { available: false }
  | { available: true; birthday: string | null; notes: string; /** null = no row yet. */ version: number | null }

export interface PersonSnapshot {
  id: string
  publicId: string
  /** The draft's revision; '' when no draft exists (call openPersonForEdit). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  anonymisedAt: string | null
  state: PersonState
  firstName: string
  lastName: string
  displayName: string
  honorific: Record<string, string>
  jobTitle: Record<string, string>
  groups: string[]
  photo: { assetId: string; url: string | null } | null
  shortBio: Record<string, string>
  /** Machine-translation status per translatable field and language (ADR-023 §4). Absent = typed by a person. */
  translations: PersonTranslations
  bio: Record<string, PortableTextBlock[]>
  languages: string[]
  website: string
  /** Public (Sanity) then private (Supabase) contacts. */
  contacts: PersonContactValue[]
  qualifications: PersonQualificationValue[]
  visibility: PersonVisibility
  slug: Record<string, string>
  sortOrder: number | null
  private: PersonPrivateSection
  live: { rev: string } | null
  usedIn: PersonUsage[]
  site: PersonSite
}

/** Fields the Translate button covers (plain text; `bio` is rich text and is not translated yet). */
export const PERSON_TRANSLATABLE_FIELDS = ['honorific', 'jobTitle', 'shortBio'] as const
export type PersonTranslatableField = (typeof PERSON_TRANSLATABLE_FIELDS)[number]
export type PersonTranslations = Record<PersonTranslatableField, Record<string, TranslationMeta>>

export interface PersonPickerItem {
  id: string
  publicId: string
  name: string
  photoUrl: string | null
  groups: string[]
  jobTitle: string
  visibility: PersonVisibility
  state: PersonState
  archived: boolean
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type PersonDeps = {
  client?: Client
  now?: () => Date
  /** New person ids. */
  uuid?: () => string
  /** New publicIds. */
  publicUuid?: () => string
  /** New array keys. */
  newKey?: () => string
  audit?: ContentAuditWriter
  read?: typeof readContentActivity
  privateStore?: PersonPrivateStore
  scheduleUsage?: ScheduleUsageFn
}

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields a person never copies between versions (no window). */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy', 'anonymisedAt'])
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_LANG = /^[a-z]{2}$/
const RAW = { perspective: 'raw' } as const
const KINDS = new Set<string>(PERSON_CONTACT_KINDS)
const VISIBILITIES = new Set<string>(PERSON_VISIBILITIES)

const defaultKey = () => randomUUID().replace(/-/g, '').slice(0, 12)

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new PersonError('not_found', 'Unknown person.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'person' && doc.projectSlug === projectSlug)
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
    if ((error as { statusCode?: number })?.statusCode === 409) throw new PersonError('conflict', 'This person was changed elsewhere.')
    throw new PersonError('failed', 'Could not save.')
  }
}

function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

/** The stored `translationStatus` of one localized field, reduced to well-formed entries. */
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

const HASH = /^[0-9a-f]{8}$/

/** Validates the status a client sends beside a translated value. `null` = clear it. */
function cleanTranslationMeta(value: unknown): TranslationMeta | null {
  if (value === null) return null
  const m = objectOf(value)
  if (!m || (m.status !== 'machine' && m.status !== 'reviewed')) throw new PersonError('invalid_value', 'Unknown translation status.')
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

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const archivedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.archivedAt === 'string' && doc.archivedAt ? doc.archivedAt : null)
const anonymisedAtOf = (...docs: Array<Doc | undefined>): string | null => {
  for (const d of docs) if (typeof d?.anonymisedAt === 'string' && d.anonymisedAt) return d.anonymisedAt
  return null
}
const visibilityOf = (v: unknown): PersonVisibility => (typeof v === 'string' && VISIBILITIES.has(v) ? (v as PersonVisibility) : DEFAULT_PERSON_VISIBILITY)
const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function stateOf(published: Doc | undefined, draft: Doc | undefined): PersonState {
  if (archivedAtOf(published ?? draft)) return 'archived'
  if (published && draft) return 'changes'
  return published ? 'published' : 'draft'
}

async function readSite(client: Client, projectSlug: string): Promise<PersonSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new PersonError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

function privateStoreOf(deps: PersonDeps): PersonPrivateStore {
  return deps.privateStore ?? createSupabasePersonPrivateStore()
}
function scheduleUsageOf(deps: PersonDeps): ScheduleUsageFn {
  return deps.scheduleUsage ?? createScheduleUsage()
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Exported so tests assert exactly what runs. Raw perspective: drafts and published. */
export const PERSON_LIST_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
      | order(_updatedAt desc)[0...${PERSON_LIMITS.people * 2}]{
        _id, _createdAt, _updatedAt, publicId, firstName, lastName, displayName, jobTitle, shortBio, groups, visibility,
        archivedAt, anonymisedAt, sortOrder,
        "photoUrl": select(photo->projectSlug == $projectSlug => photo->image.asset->url)
      }`

type ListRow = Doc & { _createdAt?: string; _updatedAt?: string; photoUrl?: unknown }

/** This project's people, in the site-wide order (sortOrder, then name). Read permission. */
export async function listPersons(ctx: TenantAuthorizationContext, projectId: string, deps: PersonDeps = {}): Promise<{ persons: PersonListItem[]; site: PersonSite }> {
  const grant = grantFor(ctx, projectId, PEOPLE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const rows = await client.fetch<ListRow[] | null>(PERSON_LIST_QUERY, { projectSlug: grant.projectSlug }, RAW)
  const byId = new Map<string, { draft?: ListRow; published?: ListRow; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = String(row._id).startsWith('drafts.')
    const id = isDraft ? String(row._id).slice('drafts.'.length) : String(row._id)
    if (!isPersonId(id)) continue
    const entry = byId.get(id) ?? { createdAt: '' }
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  const ids = [...byId.keys()]
  const used = await sanityPersonUsage(client, grant.projectSlug, ids, site.defaultLocale)
  const publicIds = [...byId.values()].map((e) => str((e.draft ?? e.published)?.publicId)).filter((x) => UUID_RE.test(x))
  const sessions = await scheduleUsageOf(deps)(projectId, publicIds)
  const persons = [...byId].map(([id, e]): PersonListItem => {
    const row = (e.draft ?? e.published)!
    const base = (e.published ?? e.draft)!
    const anonymised = Boolean(anonymisedAtOf(e.published, e.draft))
    const jobTitles = localized(row.jobTitle)
    const groups = strings(row.groups)
    const counts = { pages: 0, posts: 0, events: 0 }
    for (const u of used.get(id) ?? []) {
      if (u.kind === 'post') counts.posts++
      else if (u.kind === 'event') counts.events++
      else counts.pages++
    }
    const publicId = str(row.publicId)
    const archivedAt = archivedAtOf(base)
    const firstName = str(row.firstName)
    const lastName = str(row.lastName)
    const displayName = str(row.displayName)
    return {
      id,
      publicId,
      firstName,
      lastName,
      displayName,
      name: anonymised ? '' : personDisplayName(row),
      photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
      groups,
      jobTitle: jobTitles[site.defaultLocale] ?? Object.values(jobTitles)[0] ?? '',
      visibility: visibilityOf(row.visibility),
      state: archivedAt ? 'archived' : e.published && e.draft ? 'changes' : e.published ? 'published' : 'draft',
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt,
      anonymised,
      sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : null,
      usage: { ...counts, sessions: sessions ? (sessions.get(publicId.toLowerCase()) ?? 0) : null },
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
      searchText: [firstName, lastName, displayName, ...Object.values(jobTitles), ...groups].join(' ').toLowerCase(),
      missing: personMissing(row, site, anonymised),
    }
  })
  persons.sort(compareSiteOrder)
  return { persons, site }
}

/** The site-wide order (D6): sortOrder (missing last), then last and first name. */
export function compareSiteOrder(a: Pick<PersonListItem, 'sortOrder' | 'lastName' | 'firstName' | 'id'>, b: Pick<PersonListItem, 'sortOrder' | 'lastName' | 'firstName' | 'id'>): number {
  const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER
  const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER
  if (sa !== sb) return sa - sb
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// ── Read one ──────────────────────────────────────────────────────────────────

function publicContactsOf(doc: Doc | undefined): PersonContactValue[] {
  return (Array.isArray(doc?.contacts) ? (doc!.contacts as unknown[]) : []).flatMap((raw, n) => {
    const c = objectOf(raw)
    if (!c || !KINDS.has(str(c.kind))) return []
    return [{ _key: typeof c._key === 'string' && KEY.test(c._key) ? c._key : `contact-${n}`, kind: c.kind as PersonContactKind, value: str(c.value), label: str(c.label), preferred: c.preferred === true, visibility: 'public' as const }]
  })
}

function qualificationsOf(doc: Doc | undefined): PersonQualificationValue[] {
  return (Array.isArray(doc?.qualifications) ? (doc!.qualifications as unknown[]) : []).flatMap((raw, n) => {
    const q = objectOf(raw)
    if (!q) return []
    const d = (v: unknown) => (typeof v === 'string' && DATE.test(v) ? v : null)
    return [{ _key: typeof q._key === 'string' && KEY.test(q._key) ? q._key : `qualification-${n}`, title: localized(q.title), issuer: str(q.issuer), issuedOn: d(q.issuedOn), expiresOn: d(q.expiresOn) }]
  })
}

function bioOf(doc: Doc | undefined): Record<string, PortableTextBlock[]> {
  const out: Record<string, PortableTextBlock[]> = {}
  const b = objectOf(doc?.bio)
  for (const [loc, blocks] of Object.entries(b ?? {})) {
    if (!loc.startsWith('_') && loc !== 'translationStatus' && Array.isArray(blocks) && blocks.length) out[loc] = blocks as PortableTextBlock[]
  }
  return out
}

function slugsOf(doc: Doc | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [loc, v] of Object.entries(objectOf(doc?.slug) ?? {})) {
    const cur = objectOf(v)?.current
    if (!loc.startsWith('_') && typeof cur === 'string' && cur) out[loc] = cur
  }
  return out
}

async function usageWithSessions(client: Client, deps: PersonDeps, projectSlug: string, projectId: string, id: string, publicId: string, locale: string): Promise<PersonUsage[]> {
  const used = (await sanityPersonUsage(client, projectSlug, [id], locale)).get(id) ?? []
  if (UUID_RE.test(publicId)) {
    const sessions = await scheduleUsageOf(deps)(projectId, [publicId])
    const n = sessions?.get(publicId.toLowerCase()) ?? 0
    if (n > 0) used.push({ kind: 'sessions', id: '', title: '', published: false, count: n })
  }
  return used
}

/** The person as the editor shows it: the draft when there is one, else the published version — plus the private section. */
export async function getPersonForEdit(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: PersonDeps = {}): Promise<PersonSnapshot> {
  const grant = grantFor(ctx, projectId, PEOPLE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPersonId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  const publicId = str(doc.publicId)
  const usedIn = await usageWithSessions(client, deps, grant.projectSlug, projectId, id, publicId, site.defaultLocale)

  let privateSection: PersonPrivateSection = { available: false }
  let privateContacts: PersonContactValue[] = []
  if (UUID_RE.test(publicId)) {
    try {
      const r = await privateStoreOf(deps).read(projectId, publicId)
      if (r.available) {
        privateSection = { available: true, birthday: r.row?.birthday ?? null, notes: r.row?.notes ?? '', version: r.row?.version ?? null }
        privateContacts = (r.row?.contacts ?? []).map((c) => ({ ...c, visibility: 'private' as const }))
      }
    } catch {
      privateSection = { available: false }
    }
  }

  const photoRef = str(objectOf(doc.photo)?._ref)
  let photo: PersonSnapshot['photo'] = null
  if (photoRef) {
    const url = await client.fetch<string | null>(`*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug][0].image.asset->url`, { id: photoRef, projectSlug: grant.projectSlug })
    photo = { assetId: photoRef, url: typeof url === 'string' ? url : null }
  }

  return {
    id,
    publicId,
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    archivedAt: archivedAtOf(published ?? draft),
    anonymisedAt: anonymisedAtOf(published, draft),
    state: stateOf(published, draft),
    firstName: str(doc.firstName),
    lastName: str(doc.lastName),
    displayName: str(doc.displayName),
    honorific: localized(doc.honorific),
    jobTitle: localized(doc.jobTitle),
    groups: strings(doc.groups),
    photo,
    shortBio: localized(doc.shortBio),
    translations: { honorific: translationMetaOf(doc.honorific), jobTitle: translationMetaOf(doc.jobTitle), shortBio: translationMetaOf(doc.shortBio) },
    bio: bioOf(doc),
    languages: strings(doc.languages),
    website: str(doc.website),
    contacts: [...publicContactsOf(doc), ...privateContacts],
    qualifications: qualificationsOf(doc),
    visibility: visibilityOf(doc.visibility),
    slug: slugsOf(doc),
    sortOrder: typeof doc.sortOrder === 'number' ? doc.sortOrder : null,
    private: privateSection,
    live: published?._rev ? { rev: published._rev } : null,
    usedIn,
    site,
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

function cleanName(value: unknown, required: boolean, max: number = PERSON_LIMITS.name): string {
  if (value === undefined || value === null) {
    if (required) throw new PersonError('missing_name', 'A first name is required.')
    return ''
  }
  if (typeof value !== 'string') throw new PersonError('invalid_value', 'A name must be text.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (required && !name) throw new PersonError('missing_name', 'A first name is required.')
  if (name.length > max) throw new PersonError('invalid_value', 'The name is too long.')
  return name
}

function cleanText(value: unknown, max: number, what: string, multiline = false): string {
  if (typeof value !== 'string') throw new PersonError('invalid_value', `${what} must be text.`)
  const t = multiline ? value.replace(/\r\n/g, '\n').trim() : value.trim().replace(/\s+/g, ' ')
  if (t.length > max) throw new PersonError('invalid_value', `${what} is too long.`)
  return t
}

function cleanUrl(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > PERSON_LIMITS.website) throw new PersonError('invalid_value', 'Not a web address.')
  const v = value.trim()
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
    return u.toString()
  } catch {
    throw new PersonError('invalid_value', 'Not a web address.')
  }
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/
const PHONE = /^\+?[0-9\s\-().]{5,30}$/
const HANDLE = /^@?[A-Za-z0-9._-]{1,100}$/

/** One contact method, validated by kind. Exported for tests and the dashboard's own hints. */
export function cleanContact(raw: unknown, newKey: () => string, seen: Set<string>): Omit<PersonContactValue, 'visibility'> {
  const c = objectOf(raw)
  if (!c) throw new PersonError('invalid_value', 'Unknown contact.')
  const kind = str(c.kind)
  if (!KINDS.has(kind)) throw new PersonError('invalid_value', 'Unknown contact type.')
  const value = cleanText(c.value, PERSON_LIMITS.contactValue, 'A contact')
  if (!value) throw new PersonError('invalid_value', 'A contact needs a value.')
  const ok =
    kind === 'email' ? EMAIL.test(value)
    : kind === 'phone' || kind === 'whatsapp' ? PHONE.test(value)
    : kind === 'instagram' || kind === 'linkedin' ? HANDLE.test(value) || /^https:\/\//i.test(value)
    : /^https?:\/\//i.test(value)
  if (!ok) throw new PersonError('invalid_value', 'That contact is not valid for its type.')
  const finalValue = kind === 'website' || kind === 'url' || /^https?:\/\//i.test(value) ? cleanUrl(value) : value
  const label = c.label === undefined || c.label === null ? '' : cleanText(c.label, PERSON_LIMITS.contactLabel, 'A label')
  let key = typeof c._key === 'string' && KEY.test(c._key) && !seen.has(c._key) ? c._key : ''
  while (!key || seen.has(key)) key = newKey()
  seen.add(key)
  return { _key: key, kind: kind as PersonContactKind, value: finalValue, label, preferred: c.preferred === true }
}

function cleanContacts(value: unknown, newKey: () => string): Array<Omit<PersonContactValue, 'visibility'>> {
  if (!Array.isArray(value) || value.length > PERSON_LIMITS.contacts) throw new PersonError('invalid_value', `Up to ${PERSON_LIMITS.contacts} contacts.`)
  const seen = new Set<string>()
  return value.map((raw) => cleanContact(raw, newKey, seen))
}

function cleanDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new PersonError('invalid_value', 'Not a date.')
  return value
}

function cleanLocalized(value: unknown, allowed: Set<string>, max: number, what: string, multiline = false): Record<string, string> {
  const o = value === undefined || value === null ? {} : objectOf(value)
  if (!o) throw new PersonError('invalid_value', `${what} must be one text per language.`)
  const out: Record<string, string> = {}
  for (const [loc, v] of Object.entries(o)) {
    if (loc.startsWith('_') || loc === 'translationStatus') continue
    if (!allowed.has(loc)) throw new PersonError('invalid_value', `Language "${loc}" is not on this site.`)
    const t = cleanText(v, max, what, multiline)
    if (t) out[loc] = t
  }
  return out
}

/** Locales a draft may hold: the site's, plus any already stored in it (a removed site language never loses text on save). */
function allowedLocales(site: PersonSite, draft: Doc | undefined): Set<string> {
  const allowed = new Set(site.languages)
  const scan = (v: unknown) => {
    for (const k of Object.keys(objectOf(v) ?? {})) if (LOCALE_KEY.test(k)) allowed.add(k)
  }
  for (const f of ['honorific', 'jobTitle', 'shortBio', 'bio', 'slug']) scan(draft?.[f])
  for (const q of Array.isArray(draft?.qualifications) ? (draft!.qualifications as unknown[]) : []) scan(objectOf(q)?.title)
  return allowed
}

// ── Create / open ─────────────────────────────────────────────────────────────

/** A new, unpublished person (draft only). Only first and last name are required. Write permission. */
export async function createPerson(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { firstName: string; lastName: string },
  deps: PersonDeps = {}
): Promise<{ id: string; publicId: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  return audited({ ctx, projectId, contentType: 'person', contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const firstName = cleanName(input?.firstName, true)
    const lastName = cleanName(input?.lastName, false)
    const stats = await client.fetch<{ n?: number; max?: number | null } | null>(
      `{ "n": count(*[_type == "person" && projectSlug == $projectSlug && !(_id in path("versions.**"))]), "max": math::max(*[_type == "person" && projectSlug == $projectSlug && defined(sortOrder)].sortOrder) }`,
      { projectSlug: grant.projectSlug },
      RAW
    )
    if ((stats?.n ?? 0) >= PERSON_LIMITS.people * 2) throw new PersonError('too_large', 'This site has too many people.')
    const publicId = (deps.publicUuid ?? randomUUID)()
    const sortOrder = (typeof stats?.max === 'number' && Number.isFinite(stats.max) ? Math.floor(stats.max) : 0) + 10
    const doc = { _id: `drafts.${id}`, _type: 'person', projectSlug: grant.projectSlug, publicId, firstName, ...(lastName ? { lastName } : {}), visibility: DEFAULT_PERSON_VISIBILITY, sortOrder }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, publicId, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published person. A server action, never a GET. */
export async function openPersonForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: PersonDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const id = input?.id
  if (!isPersonId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (anonymisedAtOf(published, draft)) throw new PersonError('anonymised', 'This person was anonymised.')
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (archivedAtOf(published)) throw new PersonError('archived', 'Restore this person to edit them.')
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'person'
  copy.projectSlug = grant.projectSlug
  await singleProjectGuard(client, grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string }
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
      throw new PersonError('conflict', 'This person was changed elsewhere.')
    }
    throw new PersonError('failed', 'Could not open the person.')
  }
}

// ── Save draft ────────────────────────────────────────────────────────────────

/** Paths `savePersonDraft` accepts. `<loc>` = a language of the site. */
export const PERSON_PATCH_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'honorific.<loc>',
  'jobTitle.<loc>',
  'shortBio.<loc>',
  'bio.<loc>',
  'groups',
  'photo',
  'languages',
  'website',
  'contacts',
  'qualifications',
  'visibility',
  'slug.<loc>',
  'translation.<field>.<loc>',
] as const

const PLAIN_PATHS = new Set(['firstName', 'lastName', 'displayName', 'groups', 'photo', 'languages', 'website', 'contacts', 'qualifications', 'visibility'])
const LOCALIZED_PATHS = new Set(['honorific', 'jobTitle', 'shortBio', 'bio', 'slug'])
const LOCALIZED_TYPE: Record<string, string> = { honorific: 'localizedString', jobTitle: 'localizedString', shortBio: 'localizedText', bio: 'personBioText', slug: 'localizedSlug' }

/** Normalises a typed slug: lowercase, ASCII, single hyphens. */
export function normalisePersonSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '')
}

/** Validates and applies one autosave patch to `drafts.<id>`. Returns the new revision. Public profile only — private details use savePersonPrivate. */
export async function savePersonDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: PersonDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const newKey = deps.newKey ?? defaultKey
  if (!isPersonId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new PersonError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new PersonError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > PERSON_LIMITS.patchBytes) throw new PersonError('too_large', 'Too much at once.')
  // Field allow-list before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const translation = field === 'translation' && (PERSON_TRANSLATABLE_FIELDS as readonly string[]).includes(locale) && rest.length === 1 && LOCALE_KEY.test(rest[0])
    const ok = (PLAIN_PATHS.has(path)) || translation || (LOCALIZED_PATHS.has(field) && !!locale && LOCALE_KEY.test(locale) && rest.length === 0)
    if (!ok) throw new PersonError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, PersonSite, void]>([
    readPair(client, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (draft!._rev !== input.rev) throw new PersonError('conflict', 'This person was edited elsewhere.')
  if (anonymisedAtOf(published, draft)) throw new PersonError('anonymised', 'This person was anonymised.')
  if (archivedAtOf(published ?? draft)) throw new PersonError('archived', 'Restore this person to edit them.')

  const allowed = allowedLocales(site, draft)
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  const newRefs = new Set<string>()
  let photoId: string | null = null
  let groupKeys: string[] = []
  const slugChecks: Array<{ locale: string; slug: string }> = []

  const metaPatches: Array<{ field: PersonTranslatableField; locale: string; meta: TranslationMeta | null }> = []
  for (const [path, value] of Object.entries(input.set)) {
    const [field, locale] = path.split('.')
    if (field === 'translation') {
      const [, f, loc] = path.split('.')
      if (!allowed.has(loc)) throw new PersonError('invalid_field', `Language "${loc}" is not on this site.`)
      metaPatches.push({ field: f as PersonTranslatableField, locale: loc, meta: cleanTranslationMeta(value) })
      continue
    }
    switch (path) {
      case 'firstName':
        set[path] = cleanName(value, true)
        continue
      case 'lastName': {
        // Optional (ADR-043 A4): one-name people.
        const v = value === null ? '' : cleanName(value, false)
        if (v) set.lastName = v
        else unset.push('lastName')
        continue
      }
      case 'displayName': {
        const v = value === null ? '' : cleanName(value, false, PERSON_LIMITS.displayName)
        if (v) set.displayName = v
        else unset.push('displayName')
        continue
      }
      case 'groups': {
        if (!Array.isArray(value) || value.length > PERSON_LIMITS.groups) throw new PersonError('invalid_value', 'Too many groups.')
        const keys = [...new Set(value.map((k) => (typeof k === 'string' ? k.trim() : '')))]
        if (keys.some((k) => !isValidTermKey(k))) throw new PersonError('invalid_value', 'Unknown group.')
        groupKeys = keys
        set.groups = keys
        continue
      }
      case 'photo': {
        if (value === null || value === '') {
          unset.push('photo')
          continue
        }
        if (typeof value !== 'string' || !isPersonId(value)) throw new PersonError('invalid_value', 'Unknown photo.')
        photoId = value
        set.photo = { _type: 'reference', _ref: value }
        continue
      }
      case 'languages': {
        if (!Array.isArray(value) || value.length > PERSON_LIMITS.languages) throw new PersonError('invalid_value', 'Too many languages.')
        const langs = [...new Set(value.map((l) => (typeof l === 'string' ? l.trim().toLowerCase() : '')))]
        if (langs.some((l) => !ISO_LANG.test(l))) throw new PersonError('invalid_value', 'Use two-letter language codes.')
        set.languages = langs
        continue
      }
      case 'website': {
        const url = cleanUrl(value)
        if (url) set.website = url
        else unset.push('website')
        continue
      }
      case 'contacts': {
        // PUBLIC contacts only. Private ones are moved with movePersonContact.
        set.contacts = cleanContacts(value, newKey).map((c) => ({ ...c, _type: 'personContact' }))
        continue
      }
      case 'qualifications': {
        if (!Array.isArray(value) || value.length > PERSON_LIMITS.qualifications) throw new PersonError('invalid_value', `Up to ${PERSON_LIMITS.qualifications} qualifications.`)
        const storedByKey = new Map<string, Record<string, unknown>>()
        for (const raw of Array.isArray(draft!.qualifications) ? (draft!.qualifications as unknown[]) : []) {
          const s = objectOf(raw)
          if (s && typeof s._key === 'string') storedByKey.set(s._key, s)
        }
        const seen = new Set<string>()
        set.qualifications = value.map((raw) => {
          const q = objectOf(raw)
          if (!q) throw new PersonError('invalid_value', 'Unknown qualification.')
          let key = typeof q._key === 'string' && KEY.test(q._key) && !seen.has(q._key) ? q._key : ''
          while (!key || seen.has(key)) key = newKey()
          seen.add(key)
          const before = typeof q._key === 'string' ? storedByKey.get(q._key) : undefined
          const title: Record<string, unknown> = { _type: 'localizedString', ...cleanLocalized(q.title, allowed, PERSON_LIMITS.short, 'A qualification') }
          const status = objectOf(before?.title)?.translationStatus
          if (status !== undefined) title.translationStatus = status
          const issuer = q.issuer === undefined || q.issuer === null ? '' : cleanText(q.issuer, PERSON_LIMITS.issuer, 'The issuer')
          const issuedOn = cleanDate(q.issuedOn)
          const expiresOn = cleanDate(q.expiresOn)
          if (issuedOn && expiresOn && expiresOn < issuedOn) throw new PersonError('invalid_value', 'A qualification cannot expire before it was issued.')
          return { _key: key, _type: 'personQualification', title, ...(issuer ? { issuer } : {}), ...(issuedOn ? { issuedOn } : {}), ...(expiresOn ? { expiresOn } : {}) }
        })
        continue
      }
      case 'visibility': {
        if (typeof value !== 'string' || !VISIBILITIES.has(value)) throw new PersonError('invalid_value', 'Unknown visibility.')
        set.visibility = value
        continue
      }
    }
    // Localized paths: <field>.<locale>
    if (!allowed.has(locale)) throw new PersonError('invalid_field', `Language "${locale}" is not on this site.`)
    ensure[field] = { _type: LOCALIZED_TYPE[field] }
    if (field === 'bio') {
      let blocks: unknown[]
      try {
        blocks = sanitizeFaqAnswer(value, objectOf(draft!.bio)?.[locale])
      } catch (error) {
        if (error instanceof FaqAnswerError) throw new PersonError('invalid_value', error.message)
        throw error
      }
      if (blocks.length) set[path] = blocks
      else unset.push(path)
      const storedRefs = collectInternalRefs(objectOf(draft!.bio)?.[locale])
      for (const ref of collectInternalRefs(blocks)) if (!storedRefs.has(ref)) newRefs.add(ref)
      continue
    }
    if (field === 'slug') {
      const raw = value === null ? '' : typeof value === 'string' ? value : null
      if (raw === null) throw new PersonError('invalid_value', 'A slug must be text.')
      const slug = normalisePersonSlug(raw)
      if (raw.trim() && !SLUG.test(slug)) throw new PersonError('invalid_value', 'Not a valid web address part.')
      if (slug) {
        set[path] = { _type: 'slug', current: slug }
        slugChecks.push({ locale, slug })
      } else unset.push(path)
      continue
    }
    const max = field === 'shortBio' ? PERSON_LIMITS.shortBio : PERSON_LIMITS.short
    const t = cleanText(value, max, `"${path}"`, field === 'shortBio')
    if (t) set[path] = t
    else unset.push(path)
  }

  // Translation status (ADR-023 §4), stored beside the value. Decided on the FINAL text:
  //  · a machine value whose text no longer matches its hash was edited by a person → `reviewed`;
  //  · a cleared value loses its status.
  const nestedEnsure: Record<string, unknown> = {}
  const explicit = new Set(metaPatches.map((m) => `${m.field}.${m.locale}`))
  const textTouched = new Set<string>()
  for (const f of PERSON_TRANSLATABLE_FIELDS) for (const loc of allowed) if (`${f}.${loc}` in input.set) textTouched.add(`${f}.${loc}`)
  const statusPath = (f: string, loc: string) => `${f}.translationStatus.${loc}`
  for (const { field, locale, meta } of metaPatches) {
    const key = `${field}.${locale}`
    const finalText = typeof set[key] === 'string' ? (set[key] as string) : unset.includes(key) ? '' : str(objectOf(draft![field])?.[locale])
    if (!meta || !finalText) {
      unset.push(statusPath(field, locale))
      continue
    }
    let out: TranslationMeta = meta
    if (meta.status === 'machine' && meta.textHash) {
      const rawSent = input.set[key]
      if (typeof rawSent === 'string' && hashText(rawSent) === meta.textHash) out = { ...meta, textHash: hashText(finalText) }
      else if (hashText(finalText) !== meta.textHash) out = { ...meta, status: 'reviewed' }
    }
    set[statusPath(field, locale)] = { _type: 'translationMeta', ...out }
    nestedEnsure[`${field}.translationStatus`] = { _type: 'translationStatus' }
  }
  for (const key of textTouched) {
    if (explicit.has(key)) continue
    const [f, loc] = key.split('.')
    const stored = translationMetaOf(draft![f])[loc]
    if (!stored) continue
    if (unset.includes(key)) unset.push(statusPath(f, loc))
    else if (stored.status === 'machine' && typeof set[key] === 'string' && stored.textHash && hashText(set[key] as string) !== stored.textHash) {
      set[statusPath(f, loc)] = { _type: 'translationMeta', ...stored, status: 'reviewed' }
    }
  }

  // Project-scoped checks, one read each.
  if (photoId) {
    const ok = await client.fetch<string | null>(`*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset)][0]._id`, { id: photoId, projectSlug: grant.projectSlug })
    if (ok !== photoId) throw new PersonError('invalid_value', 'That photo is not in this website’s Media Library.')
  }
  if (groupKeys.length) {
    const found = await client.fetch<string[] | null>(
      `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == $module && kind == $kind && key in $keys].key`,
      { projectSlug: grant.projectSlug, module: PEOPLE_MODULE_ID, kind: PEOPLE_GROUP_KIND, keys: groupKeys }
    )
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!groupKeys.every((k) => ok.has(k))) throw new PersonError('invalid_value', 'Unknown group.')
  }
  if (newRefs.size) {
    const ids = [...newRefs]
    const found = await client.fetch<string[] | null>(`*[_id in $ids && _type in $types && projectSlug == $projectSlug]._id`, {
      ids,
      types: [...BODY_LINK_TARGET_TYPES],
      projectSlug: grant.projectSlug,
    })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!ids.every((x) => ok.has(x))) throw new PersonError('invalid_value', 'That link points to a page that is not on this website.')
  }
  for (const { locale, slug } of slugChecks) {
    const taken = await client.fetch<string | null>(
      `*[_type == "person" && projectSlug == $projectSlug && !(_id in [$id, $draftId]) && !(_id in path("versions.**")) && slug[$locale].current == $slug][0]._id`,
      { projectSlug: grant.projectSlug, id: input.id, draftId, locale, slug },
      RAW
    )
    if (taken) throw new PersonError('slug_taken', 'Another person already uses this web address.')
  }

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
  return { rev: result?._rev ?? '' }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

/** Publishes `drafts.<id>` in one revision-guarded transaction. A changed slug of a published language is kept as a redirect. */
export async function publishPersonDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PersonDeps = {}
): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: 'person', contentId: isPersonId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isPersonId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new PersonError('conflict', 'Missing revision.')
      const [{ published, draft }, site] = await Promise.all([readPair(client, input.id, grant.projectSlug), readSite(client, grant.projectSlug)])
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new PersonError('conflict', 'This person was edited elsewhere.')
      if (anonymisedAtOf(published, draft)) throw new PersonError('anonymised', 'This person was anonymised.')
      if (archivedAtOf(published ?? draft)) throw new PersonError('archived', 'Restore this person before publishing.')
      if (!str(draft.firstName).trim()) throw new PersonError('missing_name', 'A first name is required.')
      if (visibilityOf(draft.visibility) === 'page' && !slugsOf(draft)[site.defaultLocale]) {
        throw new PersonError('missing_slug', 'A person with their own page needs a web address in the main language.')
      }

      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = 'person'
      doc.projectSlug = grant.projectSlug
      // The publicId never changes once published (schedules key on it).
      if (published && typeof published.publicId === 'string' && published.publicId) doc.publicId = published.publicId
      if (typeof doc.publicId !== 'string' || !UUID_RE.test(doc.publicId)) doc.publicId = (deps.publicUuid ?? randomUUID)()

      // Publicly Routable Content Pattern: a published slug that changes keeps working as a redirect.
      if (published) {
        const before = slugsOf(published)
        const after = slugsOf(draft)
        const redirects: Record<string, unknown> = { _type: 'redirectFrom', ...(objectOf(draft.redirectFrom) ?? objectOf(published.redirectFrom) ?? {}) }
        let changed = false
        for (const [loc, old] of Object.entries(before)) {
          if (after[loc] === old) continue
          const list = strings(redirects[loc]).filter((s) => s !== after[loc])
          if (!list.includes(old)) list.push(old)
          redirects[loc] = list
          changed = true
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
      return { value: { rev: transactionId }, action: published ? null : ('published' as const), state }
    }
  )
}

/** Throws away unpublished changes of a published person. */
export async function discardPersonDraft(ctx: TenantAuthorizationContext, projectId: string, input: { id: string; rev: string }, deps: PersonDeps = {}): Promise<void> {
  const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPersonId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) throw new PersonError('invalid_value', 'This person was never published.')
  if (draft._rev !== input.rev) throw new PersonError('conflict', 'This person was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () => client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit())
}

// ── Private details (Supabase) ────────────────────────────────────────────────

async function personFor(ctx: TenantAuthorizationContext, projectId: string, id: unknown, permission: string, deps: PersonDeps) {
  const grant = grantFor(ctx, projectId, permission)
  const client = deps.client ?? sanityWriteClient
  if (!isPersonId(id)) notFound()
  const pair = await readPair(client, id, grant.projectSlug)
  const doc = pair.draft ?? pair.published
  if (!doc) notFound()
  const publicId = str(doc.publicId)
  if (!UUID_RE.test(publicId)) throw new PersonError('failed', 'This person has no public id.')
  return { grant, client, ...pair, doc, publicId }
}

/**
 * Saves the private section: birthday, internal notes and/or the whole list of
 * PRIVATE contacts. `version` is what getPersonForEdit returned (null = no row
 * yet). Write permission. Refused with `private_unavailable` while migration
 * 063 is not applied.
 */
export async function savePersonPrivate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; version: number | null; birthday?: string | null; notes?: string | null; contacts?: unknown[] },
  deps: PersonDeps = {}
): Promise<{ version: number }> {
  const { published, draft, publicId } = await personFor(ctx, projectId, input?.id, PEOPLE_WRITE_PERMISSION, deps)
  if (anonymisedAtOf(published, draft)) throw new PersonError('anonymised', 'This person was anonymised.')
  const write: { birthday?: string | null; notes?: string | null; contacts?: PersonPrivateContact[] } = {}
  if (input.birthday !== undefined) write.birthday = cleanDate(input.birthday)
  if (input.notes !== undefined) {
    const n = input.notes === null ? '' : cleanText(input.notes, PERSON_LIMITS.notes, 'The notes', true)
    write.notes = n || null
  }
  if (input.contacts !== undefined) write.contacts = cleanContacts(input.contacts, deps.newKey ?? defaultKey)
  if (input.version !== null && (typeof input.version !== 'number' || !Number.isInteger(input.version))) throw new PersonError('conflict', 'Missing version.')
  const row = await privateStoreOf(deps).save(projectId, publicId, write, input.version)
  return { version: row.version }
}

/**
 * Moves one contact method between public (Sanity — on the website) and
 * private (Supabase — never on the website) — ADR-043 D2.
 *
 * Order: the contact is ADDED to its destination first and REMOVED from its
 * source second, so a failure in between leaves a duplicate, never a loss; the
 * second step is undone when it cannot complete (best effort), and a retry
 * finishes the move.
 *   - to 'private': applies at once to the published person AND the draft
 *     (privacy first: it leaves the website now, without a publish).
 *   - to 'public': lands in the DRAFT (call openPersonForEdit first; `rev` is
 *     the draft revision); it reaches the website on the next publish.
 * Write permission.
 */
export async function movePersonContact(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; key: string; to: 'public' | 'private'; privateVersion: number | null },
  deps: PersonDeps = {}
): Promise<{ rev: string; privateVersion: number }> {
  if (input?.to !== 'public' && input?.to !== 'private') throw new PersonError('invalid_value', 'Unknown move.')
  if (typeof input.key !== 'string' || !KEY.test(input.key)) throw new PersonError('invalid_value', 'Unknown contact.')
  const { grant, client, published, draft, publicId } = await personFor(ctx, projectId, input.id, PEOPLE_WRITE_PERMISSION, deps)
  if (anonymisedAtOf(published, draft)) throw new PersonError('anonymised', 'This person was anonymised.')
  if (archivedAtOf(published ?? draft)) throw new PersonError('archived', 'Restore this person to edit them.')
  const store = privateStoreOf(deps)
  const current = await store.read(projectId, publicId)
  if (!current.available) throw new PersonError('private_unavailable', 'Private details cannot be stored yet.')
  const version = current.row?.version ?? null
  if (version !== input.privateVersion) throw new PersonError('conflict', 'The private details were changed elsewhere.')
  const privateContacts = current.row?.contacts ?? []
  const withoutKey = (list: unknown) => (Array.isArray(list) ? list.filter((c) => objectOf(c)?._key !== input.key) : [])

  if (input.to === 'private') {
    const source = publicContactsOf(draft ?? published).find((c) => c._key === input.key)
    if (!source) throw new PersonError('not_found', 'Unknown contact.')
    if (draft && draft._rev !== input.rev) throw new PersonError('conflict', 'This person was edited elsewhere.')
    if (privateContacts.length >= PERSON_LIMITS.contacts) throw new PersonError('invalid_value', `Up to ${PERSON_LIMITS.contacts} contacts.`)
    // 1. Add to private.
    const { visibility: _v, ...contact } = source
    void _v
    const saved = await store.save(projectId, publicId, { contacts: [...privateContacts.filter((c) => c._key !== input.key), contact] }, version)
    // 2. Remove from every public version.
    try {
      const tx = (await commit(client, grant.projectSlug, () => {
        let t = client.transaction()
        if (published?._rev) t = t.patch(input.id, { ifRevisionID: published._rev, set: { contacts: withoutKey(published.contacts) } })
        if (draft?._rev) t = t.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev, set: { contacts: withoutKey(draft.contacts) } })
        return t.commit()
      })) as { transactionId?: string } | undefined
      return { rev: draft ? (tx?.transactionId ?? '') : '', privateVersion: saved.version }
    } catch (error) {
      // Undo step 1 (the contact is still public, so nothing is lost).
      await store.save(projectId, publicId, { contacts: privateContacts }, saved.version).catch(() => undefined)
      throw error
    }
  }

  // to 'public'
  const source = privateContacts.find((c) => c._key === input.key)
  if (!source) throw new PersonError('not_found', 'Unknown contact.')
  if (!draft) throw new PersonError('conflict', 'Open the person for editing first.')
  if (draft._rev !== input.rev) throw new PersonError('conflict', 'This person was edited elsewhere.')
  const publicList = withoutKey(draft.contacts)
  if (publicList.length >= PERSON_LIMITS.contacts) throw new PersonError('invalid_value', `Up to ${PERSON_LIMITS.contacts} contacts.`)
  // 1. Add to the public draft.
  const res = (await commit(client, grant.projectSlug, () =>
    client
      .patch(`drafts.${input.id}`)
      .ifRevisionId(input.rev)
      .set({ contacts: [...publicList, { ...source, _type: 'personContact' }] })
      .commit()
  )) as { _rev?: string } | undefined
  const rev = res?._rev ?? ''
  // 2. Remove from private.
  try {
    const saved = await store.save(projectId, publicId, { contacts: privateContacts.filter((c) => c._key !== input.key) }, version)
    return { rev, privateVersion: saved.version }
  } catch (error) {
    // Undo step 1 (the contact is still private, so nothing is lost).
    await client
      .patch(`drafts.${input.id}`)
      .ifRevisionId(rev)
      .set({ contacts: publicList })
      .commit()
      .catch(() => undefined)
    throw error
  }
}

// ── Reorder ───────────────────────────────────────────────────────────────────

/**
 * Sets the site-wide order (D6) from the full ordered list of person ids.
 * Order is not editorial content: it applies at once to the published person
 * and to the draft, without publishing either. Write permission.
 */
export async function reorderPersons(ctx: TenantAuthorizationContext, projectId: string, input: { ids: string[] }, deps: PersonDeps = {}): Promise<void> {
  const grant = grantFor(ctx, projectId, PEOPLE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const ids = input?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > PERSON_LIMITS.people) throw new PersonError('invalid_value', 'Nothing to order.')
  if (ids.some((x) => !isPersonId(x)) || new Set(ids).size !== ids.length) throw new PersonError('invalid_value', 'Unknown person.')
  const existing = await client.fetch<string[] | null>(
    `*[_type == "person" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]._id`,
    { projectSlug: grant.projectSlug, ids, draftIds: ids.map((x) => `drafts.${x}`) },
    RAW
  )
  const found = new Set(Array.isArray(existing) ? existing : [])
  if (!ids.every((x) => found.has(x) || found.has(`drafts.${x}`))) notFound()
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction()
    ids.forEach((id, i) => {
      const sortOrder = (i + 1) * 10
      if (found.has(id)) tx = tx.patch(id, { set: { sortOrder } })
      if (found.has(`drafts.${id}`)) tx = tx.patch(`drafts.${id}`, { set: { sortOrder } })
    })
    return tx.commit()
  })
}

// ── Bulk changes (list: several people at once) ───────────────────────────────

export const PERSON_BULK_OPS = ['addGroup', 'removeGroup', 'archive', 'show', 'hide'] as const
export type PersonBulkOp = (typeof PERSON_BULK_OPS)[number]
/** One call changes at most this many people. */
export const PERSON_BULK_MAX = 100
export type PersonBulkSkipReason = 'archived' | 'anonymised' | 'unchanged' | 'unpublished'
export interface PersonBulkResult {
  /** Ids that were changed. */
  changed: string[]
  /** Ids left as they were, with why (never an error). */
  skipped: Array<{ id: string; reason: PersonBulkSkipReason }>
  /** Ids that should have changed but could not (opaque code, same as the single-person calls). */
  failed: Array<{ id: string; code: PersonErrorCode }>
}

/** Exported so tests assert exactly what runs. Raw perspective: published and draft of each id. */
export const PERSON_BULK_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{
        _id, _rev, _type, projectSlug, publicId, groups, visibility, archivedAt, anonymisedAt
      }`

/**
 * Several people at once — `addGroup` / `removeGroup` (needs `group`), `show`
 * (off → "listed") / `hide` (→ "off") with people.person.write; `archive` with
 * people.person.archive. The permission is checked before any read.
 *
 * Semantics (decided, consistent with `reorderPersons` and with how
 * `runPersonLifecycle` archives): these are site-level settings, not editorial
 * text, so a change applies AT ONCE to the published person and to its draft
 * (when there is one) — it never publishes the draft's other edits, and a
 * person who was never published only changes in the draft (they stay draft).
 * Catalogue's bulk bar works the same way: one existing per-item operation per
 * row, never a hidden publish. Archive is `runPersonLifecycle` per person
 * (published people only, as the row menu offers it).
 *
 * Every id must be a person of the grant's project (else `not_found` for the
 * whole call, before any write — ids cannot be probed). Archived people can't
 * be edited and anonymised people are never touched: both are reported in
 * `skipped`, as are people already in the wanted state. Each person is its own
 * revision-guarded transaction; a refusal or conflict on one is reported in
 * `failed` and does not stop the others. Audit: archive is audited by the
 * lifecycle service; the settings changes are not lifecycle events (as for
 * editing a published person) so success records nothing, but a refusal or a
 * failure is recorded per person through `audited`.
 */
export async function bulkUpdatePersons(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { ids: string[]; op: PersonBulkOp; group?: string },
  deps: PersonDeps = {}
): Promise<PersonBulkResult> {
  const op = input?.op
  if (!(PERSON_BULK_OPS as readonly unknown[]).includes(op)) throw new PersonError('invalid_value', 'Unknown action.')
  const grant = grantFor(ctx, projectId, op === 'archive' ? PEOPLE_ARCHIVE_PERMISSION : PEOPLE_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const ids = input.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > PERSON_BULK_MAX) throw new PersonError('invalid_value', 'Nothing selected.')
  if (ids.some((x) => !isPersonId(x)) || new Set(ids).size !== ids.length) throw new PersonError('invalid_value', 'Unknown person.')
  let group = ''
  if (op === 'addGroup' || op === 'removeGroup') {
    group = typeof input.group === 'string' ? input.group.trim() : ''
    if (!isValidTermKey(group)) throw new PersonError('invalid_value', 'Unknown group.')
  }

  const rows = await client.fetch<Doc[] | null>(PERSON_BULK_QUERY, { projectSlug: grant.projectSlug, ids, draftIds: ids.map((x) => `drafts.${x}`) }, RAW)
  const byId = new Map<string, { published?: Doc; draft?: Doc }>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!ours(row, grant.projectSlug)) continue
    const rid = String(row._id)
    const draft = rid.startsWith('drafts.')
    const id = draft ? rid.slice('drafts.'.length) : rid
    const entry = byId.get(id) ?? {}
    if (draft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  if (!ids.every((id) => byId.has(id))) notFound()

  if (op === 'addGroup') {
    const found = await client.fetch<string[] | null>(
      `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == $module && kind == $kind && key in $keys].key`,
      { projectSlug: grant.projectSlug, module: PEOPLE_MODULE_ID, kind: PEOPLE_GROUP_KIND, keys: [group] }
    )
    if (!Array.isArray(found) || !found.includes(group)) throw new PersonError('invalid_value', 'Unknown group.')
  }

  const result: PersonBulkResult = { changed: [], skipped: [], failed: [] }
  const guard = singleProjectGuard(client, grant.projectSlug)
  await guard // one project check for the whole call; a failure refuses everything
  for (const id of ids) {
    const { published, draft } = byId.get(id)!
    if (anonymisedAtOf(published, draft)) {
      result.skipped.push({ id, reason: 'anonymised' })
      continue
    }
    if (archivedAtOf(published ?? draft)) {
      result.skipped.push({ id, reason: 'archived' })
      continue
    }
    try {
      if (op === 'archive') {
        if (!published) {
          result.skipped.push({ id, reason: 'unpublished' })
          continue
        }
        await runPersonLifecycle(ctx, projectId, { id, op: 'archive' }, deps)
        result.changed.push(id)
        continue
      }
      const docs = [published, draft].filter((d): d is Doc => Boolean(d))
      const patches = docs.flatMap((d): Array<{ doc: Doc; set: Record<string, unknown> }> => {
        if (op === 'show' || op === 'hide') {
          const to: PersonVisibility = op === 'show' ? 'listed' : 'off'
          const now = visibilityOf(d.visibility)
          return (op === 'show' ? now === 'off' : now !== 'off') ? [{ doc: d, set: { visibility: to } }] : []
        }
        const groups = strings(d.groups)
        if (op === 'addGroup') {
          if (groups.includes(group)) return []
          if (groups.length >= PERSON_LIMITS.groups) throw new PersonError('invalid_value', 'Too many groups.')
          return [{ doc: d, set: { groups: [...groups, group] } }]
        }
        return groups.includes(group) ? [{ doc: d, set: { groups: groups.filter((k) => k !== group) } }] : []
      })
      if (!patches.length) {
        result.skipped.push({ id, reason: 'unchanged' })
        continue
      }
      await audited(
        { ctx, projectId, contentType: 'person', contentId: id, intended: 'published', writer: deps.audit },
        async (transactionId) => {
          await commit(
            client,
            grant.projectSlug,
            () => {
              let tx = client.transaction()
              for (const { doc, set } of patches) tx = tx.patch(String(doc._id), { ifRevisionID: doc._rev ?? '', set })
              return tx.commit({ transactionId })
            },
            guard
          )
          return { value: undefined, action: null }
        }
      )
      result.changed.push(id)
    } catch (error) {
      if (error instanceof TenantAuthorizationError) throw error
      result.failed.push({ id, code: error instanceof PersonError ? error.code : 'failed' })
    }
  }
  return result
}

// ── Picker search ─────────────────────────────────────────────────────────────

export const PERSON_PICKER_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && !(_id in path("versions.**")) && !defined(anonymisedAt)]
      | order(coalesce(sortOrder, 999999) asc, lower(lastName) asc)[0...${PERSON_LIMITS.people * 2}]{
        _id, publicId, firstName, lastName, displayName, jobTitle, groups, visibility, archivedAt,
        "photoUrl": select(photo->projectSlug == $projectSlug => photo->image.asset->url)
      }`

/**
 * The shared PersonPicker's search (ADR-043 D8): this project's people (drafts
 * included — a just-created person can be attached), anonymised ones never,
 * archived ones only with `includeArchived`. `query` matches names, job titles
 * (all languages) and group keys. `publicIds` / `ids` resolve already-picked
 * people regardless of the query. Read permission.
 */
export async function searchPersons(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { query?: string; limit?: number; includeArchived?: boolean; ids?: string[]; publicIds?: string[] } = {},
  deps: PersonDeps = {}
): Promise<PersonPickerItem[]> {
  const grant = grantFor(ctx, projectId, PEOPLE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const q = typeof input.query === 'string' ? input.query.trim().toLowerCase().slice(0, 100) : ''
  const limit = Math.max(1, Math.min(typeof input.limit === 'number' ? Math.floor(input.limit) : 20, 100))
  const wantIds = new Set(Array.isArray(input.ids) ? input.ids.filter(isPersonId) : [])
  const wantPublic = new Set(Array.isArray(input.publicIds) ? input.publicIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()) : [])
  const [rows, site] = await Promise.all([
    client.fetch<Array<Doc & { photoUrl?: unknown }> | null>(PERSON_PICKER_QUERY, { projectSlug: grant.projectSlug }, RAW),
    readSite(client, grant.projectSlug),
  ])
  const byId = new Map<string, { draft?: Doc & { photoUrl?: unknown }; published?: Doc & { photoUrl?: unknown } }>()
  for (const row of rows ?? []) {
    const isDraft = String(row._id).startsWith('drafts.')
    const id = isDraft ? String(row._id).slice('drafts.'.length) : String(row._id)
    if (!isPersonId(id)) continue
    const e = byId.get(id) ?? {}
    if (isDraft) e.draft = row
    else e.published = row
    byId.set(id, e)
  }
  const out: PersonPickerItem[] = []
  const picked: PersonPickerItem[] = []
  for (const [id, e] of byId) {
    const row = (e.draft ?? e.published)!
    const base = (e.published ?? e.draft)!
    const archived = Boolean(archivedAtOf(base))
    const titles = localized(row.jobTitle)
    const item: PersonPickerItem = {
      id,
      publicId: str(row.publicId),
      name: personDisplayName(row),
      photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
      groups: strings(row.groups),
      jobTitle: titles[site.defaultLocale] ?? Object.values(titles)[0] ?? '',
      visibility: visibilityOf(row.visibility),
      state: archived ? 'archived' : e.published && e.draft ? 'changes' : e.published ? 'published' : 'draft',
      archived,
    }
    if (wantIds.has(id) || wantPublic.has(item.publicId.toLowerCase())) {
      picked.push(item)
      continue
    }
    if (archived && !input.includeArchived) continue
    const hay = [str(row.firstName), str(row.lastName), str(row.displayName), ...Object.values(titles), ...item.groups].join(' ').toLowerCase()
    if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue
    out.push(item)
  }
  return [...picked, ...out.slice(0, limit)]
}

// ── Archive / restore / delete ────────────────────────────────────────────────

export const PERSON_LIFECYCLE_OPS = ['archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type PersonLifecycleOp = (typeof PERSON_LIFECYCLE_OPS)[number]

/**
 * Archive / restore (people.person.archive) and delete (people.person.delete)
 * through the lifecycle service. Delete is refused while anything references
 * the person (`in_use`, `detail.usedIn`), including event schedules. After a
 * delete the private row is removed too (best effort: `privateRemoved`).
 * Returns the DRAFT's new revision (archive / restore also touch the draft).
 */
export async function runPersonLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: PersonLifecycleOp },
  deps: PersonDeps = {}
): Promise<{ rev: string | null; privateRemoved?: boolean }> {
  if (!(PERSON_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new PersonError('invalid_value', 'Unknown action.')
  const deleting = input.op === 'deleteDraft' || input.op === 'deletePermanently'
  // Gate before any read (the service re-checks).
  const grant = grantFor(ctx, projectId, deleting ? PEOPLE_DELETE_PERMISSION : PEOPLE_ARCHIVE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  if (!isPersonId(input.id)) notFound()
  const probe = personLifecycle({ projectId, publicId: null, scheduleUsage: scheduleUsageOf(deps) })
  const { published, draft } = await lifecycle.readPair(probe, client, input.id, grant.projectSlug)
  const publicId = str((published ?? draft)?.publicId)
  const d = personLifecycle({ projectId, publicId: UUID_RE.test(publicId) ? publicId : null, scheduleUsage: scheduleUsageOf(deps) })
  const args = { id: input.id, rev: (input.op === 'deleteDraft' ? draft?._rev : published?._rev) ?? '' }
  try {
    switch (input.op) {
      case 'archive': {
        const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'restore': {
        const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        // A person has no publication window: restore puts them straight back
        // (the service leaves expiresAt = archive time, which means nothing
        // here; it is removed so no reader ever mistakes it for an end date).
        const raw = (deps.client ?? sanityWriteClient) as Client
        const tx = (await commit(raw, grant.projectSlug, () => {
          let t = raw.transaction().patch(input.id, { unset: ['expiresAt'] })
          if (draft) t = t.patch(`drafts.${input.id}`, { unset: ['expiresAt'] })
          return t.commit()
        })) as { transactionId?: string } | undefined
        return { rev: draft ? (tx?.transactionId ?? r.draftRev) : r.draftRev }
      }
      case 'deleteDraft':
      case 'deletePermanently': {
        if (input.op === 'deleteDraft') await lifecycle.deleteDraft(d, ctx, projectId, args, sdeps)
        else await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
        let privateRemoved = true
        if (UUID_RE.test(publicId)) {
          try {
            await privateStoreOf(deps).remove(projectId, publicId)
          } catch {
            privateRemoved = false
          }
        }
        return { rev: null, privateRemoved }
      }
    }
  } catch (error) {
    const referrers = (error as { referrers?: lifecycle.Referrer[] } | null)?.referrers
    if (error instanceof PersonError && error.code === 'in_use' && referrers?.length) {
      const usedIn: PersonUsage[] = referrers.map((r) =>
        r.type === 'eventSessions'
          ? { kind: 'sessions' as const, id: '', title: r.label, published: false }
          : { kind: r.type === 'post' ? ('post' as const) : r.type === 'event' ? ('event' as const) : ('page' as const), id: r.id, title: r.label, published: false }
      )
      throw new PersonError('in_use', error.message, { usedIn })
    }
    throw error
  }
}

// ── Anonymise ─────────────────────────────────────────────────────────────────

/** Every public field anonymise removes. Kept: _id, publicId, projectSlug, sortOrder, archive fields. */
export const ANONYMISE_UNSET = [
  'displayName',
  'honorific',
  'jobTitle',
  'groups',
  'photo',
  'shortBio',
  'bio',
  'languages',
  'website',
  'contacts',
  'qualifications',
  'slug',
  'redirectFrom',
  'legacyAnchors',
] as const

/**
 * Anonymise (ADR-043 D4, owner only): removes the person's identifying data
 * for good — names become empty, photo, bios, contacts, links, qualifications,
 * groups and slugs are removed, the private row (private contacts, birthday,
 * notes) is deleted. The publicId and the document stay, so old references
 * resolve to "nothing" (anonymised people are never rendered). The draft is
 * removed with it. Idempotent: running it again retries the private delete.
 * Sanity first, then Supabase; `privateRemoved` false = retry.
 */
export async function anonymisePerson(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: PersonDeps = {}
): Promise<{ rev: string; privateRemoved: boolean }> {
  return audited(
    { ctx, projectId, contentType: 'person', contentId: isPersonId(input?.id) ? input.id : null, intended: 'deleted', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, PEOPLE_ANONYMISE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isPersonId(input?.id)) notFound()
      const { published, draft } = await readPair(client, input.id, grant.projectSlug)
      if (!published && !draft) notFound()
      const publicId = str((published ?? draft)!.publicId)
      const at = anonymisedAtOf(published, draft) ?? (deps.now ?? (() => new Date()))().toISOString()
      const change = { set: { firstName: '', lastName: '', visibility: 'off', anonymisedAt: at }, unset: [...ANONYMISE_UNSET] }
      await commit(client, grant.projectSlug, () => {
        let tx = client.transaction()
        if (published) {
          tx = tx.patch(input.id, { ifRevisionID: published._rev ?? '', ...change })
          if (draft) tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev ?? '', unset: ['_lifecycleGuard'] }).delete(`drafts.${input.id}`)
        } else {
          tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft!._rev ?? '', ...change })
        }
        return tx.commit({ transactionId })
      })
      let privateRemoved = true
      if (UUID_RE.test(publicId)) {
        try {
          await privateStoreOf(deps).remove(projectId, publicId)
        } catch {
          privateRemoved = false
        }
      }
      return { value: { rev: transactionId, privateRemoved }, action: 'deleted' as const, detail: { anonymised: true, privateRemoved } }
    }
  )
}

// ── Activity ──────────────────────────────────────────────────────────────────

/** The person's Activity (ADR-032 D9). Read permission; the person must be this project's. */
export async function getPersonActivity(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: PersonDeps = {}): Promise<ActivityItem[]> {
  const grant = grantFor(ctx, projectId, PEOPLE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPersonId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  return (deps.read ?? readContentActivity)({ projectId, contentType: 'person', contentIds: [input.id] })
}

export type { PersonPrivateRow }
