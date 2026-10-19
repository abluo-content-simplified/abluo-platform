/**
 * Client dashboard — FAQ sets (FAQ module, ADR-037 slices 3+4).
 *
 * Edits go to a DRAFT (`drafts.<setId>`); only "Publish" changes the website
 * (and every page/post that shows the set, D3). Same enforcement as
 * gallery-drafts / post-drafts / the lifecycle service:
 *   1. `assertModuleAction(ctx, projectId, faq.set.*)` before any I/O;
 *      identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `faqSet`s of the grant's project — anything else
 *      is "not_found", so ids cannot be probed.
 *   3. Patch allow-list (`internalName`, `note`, `title.<loc>`, `items`);
 *      `items` are REBUILT server-side (question → localizedString, answer →
 *      sanitized restricted rich text, D12). NEW internal link references must
 *      be link-target documents of this project.
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (FaqSetErrorCode).
 *   6. Archive / restore / delete go through the one lifecycle service with
 *      the FAQ descriptor (faq-lifecycle.ts).
 */
import { randomUUID } from 'crypto'
import type { PortableTextBlock } from '@portabletext/editor'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import { readContentActivity, type ActivityItem } from '@/lib/lifecycle/activity'
import * as lifecycle from '@/lib/lifecycle/service'
import { lifecycleAction, snapshotOf } from '@/lib/lifecycle/transition'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { collectInternalRefs, FaqAnswerError, sanitizeFaqAnswer } from '@/lib/faq/answer-blocks'
import { BODY_LINK_TARGET_TYPES } from '@/lib/links/target-types'
import { searchLinkTargets, type LinkTargetResult } from '@/lib/api/post-link-search'
import {
  FAQ_DELETE_PERMISSION,
  FAQ_READ_PERMISSION,
  FAQ_SET_LIFECYCLE,
  FAQ_WRITE_PERMISSION,
  FaqSetError,
  isFaqSetId,
  type FaqSetErrorCode,
  type FaqSetUsage,
} from '@/lib/api/faq-lifecycle'

export { FAQ_DELETE_PERMISSION, FAQ_READ_PERMISSION, FAQ_WRITE_PERMISSION, FaqSetError, isFaqSetId }
export type { FaqSetErrorCode, FaqSetUsage }

export const FAQ_LIMITS = { name: 120, note: 500, title: 200, question: 300, items: 100, sets: 500, patchBytes: 500_000 } as const

export type FaqSetState = 'draft' | 'published' | 'changes' | 'archived'
/** languages[0] = the default language. */
export interface FaqSite {
  defaultLocale: string
  languages: string[]
}

export interface FaqSetListItem {
  id: string
  name: string
  count: number
  /** Up to 2, in the default language. */
  firstQuestions: string[]
  /** Site languages where at least one item lacks its question or its answer. */
  missingLocales: string[]
  usedIn: FaqSetUsage[]
  state: FaqSetState
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  updatedAt: string
  createdAt: string
  /** Lower-cased name + every question in every language (client-side search). */
  searchText: string
}

export interface FaqEntryValue {
  _key: string
  question: Record<string, string>
  answer: Record<string, PortableTextBlock[]>
}

export interface FaqSetSnapshot {
  id: string
  /** The draft's revision; '' when no draft exists (call openFaqSetForEdit). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  state: FaqSetState
  name: string
  note: string
  title: Record<string, string>
  items: FaqEntryValue[]
  live: { rev: string } | null
  usedIn: FaqSetUsage[]
  site: FaqSite
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type FaqDeps = {
  client?: Client
  now?: () => Date
  /** New set ids. */
  uuid?: () => string
  /** New item keys. */
  newKey?: () => string
  audit?: ContentAuditWriter
  read?: typeof readContentActivity
  /** Link search (scoped fetch), for tests. */
  fetch?: SanityFetchFn
}

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields a set never copies between versions (no window, ADR-037 D2). */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const RAW = { perspective: 'raw' } as const

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new FaqSetError('not_found', 'Unknown FAQ set.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'faqSet' && doc.projectSlug === projectSlug)
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
    if ((error as { statusCode?: number })?.statusCode === 409) throw new FaqSetError('conflict', 'This FAQ set was changed elsewhere.')
    throw new FaqSetError('failed', 'Could not save.')
  }
}

function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

const pickText = (value: unknown, locale: string): string => {
  const v = localized(value)
  return v[locale] ?? v.en ?? Object.values(v)[0] ?? ''
}

const archivedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.archivedAt === 'string' && doc.archivedAt ? doc.archivedAt : null)

function stateOf(published: Doc | undefined, draft: Doc | undefined): FaqSetState {
  if (archivedAtOf(published ?? draft)) return 'archived'
  if (published && draft) return 'changes'
  return published ? 'published' : 'draft'
}

async function readSite(client: Client, projectSlug: string): Promise<FaqSite> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new FaqSetError('failed', 'Site languages are not configured.')
  return { defaultLocale, languages: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

// ── Where a set is shown ──────────────────────────────────────────────────────

/** Pages (and the legacy home page) and posts that reference the sets, in any version. */
export const FAQ_USAGE_QUERY = /* groq */ `*[_type in ["page", "homePage", "post"] && projectSlug == $projectSlug
    && !(_id in path("versions.**")) && references($ids)]{
    _id, _type, title,
    "live": select(_type == "post" => ${publicFilterFor('post')}, true),
    "refs": array::compact([
      ...coalesce(sections[_type == "faqSection"].faqSets[]._ref, []),
      ...coalesce(faqSets[]._ref, [])
    ])
  }`

type UsageRow = { _id: string; _type: string; title?: unknown; live?: boolean | null; refs?: unknown }

async function usage(client: Client, projectSlug: string, ids: string[], locale: string): Promise<Map<string, FaqSetUsage[]>> {
  const map = new Map<string, FaqSetUsage[]>()
  if (!ids.length) return map
  const rows = await client.fetch<UsageRow[] | null>(FAQ_USAGE_QUERY, { projectSlug, ids }, RAW)
  const docs = new Map<string, { kind: 'page' | 'post'; title: string; refs: Set<string>; publishedRefs: Set<string>; hasDraftTitle: boolean }>()
  for (const row of rows ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    const refs = Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : []
    const entry = docs.get(id) ?? { kind: row._type === 'post' ? ('post' as const) : ('page' as const), title: '', refs: new Set<string>(), publishedRefs: new Set<string>(), hasDraftTitle: false }
    for (const r of refs) entry.refs.add(r)
    if (!isDraft && row.live !== false) for (const r of refs) entry.publishedRefs.add(r)
    const title = pickText(row.title, locale)
    if (title && (isDraft || !entry.hasDraftTitle)) {
      entry.title = title
      entry.hasDraftTitle = isDraft
    }
    docs.set(id, entry)
  }
  for (const [docId, d] of docs) {
    for (const setId of ids) {
      if (!d.refs.has(setId)) continue
      const list = map.get(setId) ?? []
      list.push({ kind: d.kind, id: docId, title: d.title, published: d.publishedRefs.has(setId) })
      map.set(setId, list)
    }
  }
  return map
}

// ── List ──────────────────────────────────────────────────────────────────────

type ListRow = {
  _id: string
  _createdAt?: string
  _updatedAt?: string
  internalName?: unknown
  archivedAt?: unknown
  count?: number | null
  entries?: Array<{ q?: unknown; a?: Record<string, unknown> | null }> | null
}

function listQuery(languages: readonly string[]): string {
  // Language codes come from the site's own configuration; only well-formed ones are interpolated.
  const has = languages.filter((l) => LOCALE_KEY.test(l)).map((l) => `${JSON.stringify(l)}: count(answer[${JSON.stringify(l)}])`)
  return `*[_type == "faqSet" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
      | order(_updatedAt desc)[0...${FAQ_LIMITS.sets * 2}]{ _id, _createdAt, _updatedAt, internalName, archivedAt, "count": count(items),
        "entries": items[]{ "q": question, "a": { ${has.join(', ')} } } }`
}

/** This project's FAQ sets, most recently changed first. Read permission. */
export async function listFaqSets(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: FaqDeps = {}
): Promise<{ sets: FaqSetListItem[]; site: FaqSite }> {
  const grant = grantFor(ctx, projectId, FAQ_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const rows = await client.fetch<ListRow[] | null>(listQuery(site.languages), { projectSlug: grant.projectSlug }, RAW)
  const byId = new Map<string, { row: ListRow; draft?: ListRow; published?: ListRow; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    if (!isFaqSetId(id)) continue
    const entry = byId.get(id) ?? { row, createdAt: '' }
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  const used = await usage(client, grant.projectSlug, [...byId.keys()], site.defaultLocale)
  const sets = [...byId].map(([id, e]) => {
    const row = (e.draft ?? e.published)!
    const entries = Array.isArray(row.entries) ? row.entries : []
    const name = typeof row.internalName === 'string' ? row.internalName : ''
    const missing = site.languages.filter((l) => entries.some((x) => !localized(x.q)[l] || !(typeof x.a?.[l] === 'number' && (x.a[l] as number) > 0)))
    const questions = entries.map((x) => localized(x.q))
    const base = (e.published ?? e.draft)!
    const archivedAt = typeof base.archivedAt === 'string' && base.archivedAt ? base.archivedAt : null
    const state: FaqSetState = archivedAt ? 'archived' : e.published && e.draft ? 'changes' : e.published ? 'published' : 'draft'
    return {
      id,
      name,
      count: typeof row.count === 'number' ? row.count : entries.length,
      firstQuestions: questions
        .map((q) => q[site.defaultLocale] ?? q.en ?? Object.values(q)[0] ?? '')
        .filter(Boolean)
        .slice(0, 2),
      missingLocales: missing,
      usedIn: used.get(id) ?? [],
      state,
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt,
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
      searchText: [name, ...questions.flatMap((q) => Object.values(q))].join(' ').toLowerCase(),
    } satisfies FaqSetListItem
  })
  sets.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { sets, site }
}

// ── Read one ──────────────────────────────────────────────────────────────────

function entriesOf(doc: Doc | undefined): FaqEntryValue[] {
  const raw = Array.isArray(doc?.items) ? (doc!.items as Array<Record<string, unknown>>) : []
  return raw
    .filter((i) => i && typeof i === 'object')
    .map((i, n) => {
      const answer: Record<string, PortableTextBlock[]> = {}
      const a = i.answer
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        for (const [loc, blocks] of Object.entries(a as Record<string, unknown>)) {
          if (!loc.startsWith('_') && Array.isArray(blocks) && blocks.length) answer[loc] = blocks as PortableTextBlock[]
        }
      }
      return { _key: typeof i._key === 'string' && KEY.test(i._key) ? i._key : `item-${n}`, question: localized(i.question), answer }
    })
}

/** The set as the editor shows it: the draft when there is one, else the published version. */
export async function getFaqSet(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: FaqDeps = {}): Promise<FaqSetSnapshot> {
  const grant = grantFor(ctx, projectId, FAQ_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isFaqSetId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  const used = await usage(client, grant.projectSlug, [id], site.defaultLocale)
  return {
    id,
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    archivedAt: archivedAtOf(published ?? draft),
    state: stateOf(published, draft),
    name: typeof doc.internalName === 'string' ? doc.internalName : '',
    note: typeof doc.note === 'string' ? doc.note : '',
    title: localized(doc.title),
    items: entriesOf(doc),
    live: published?._rev ? { rev: published._rev } : null,
    usedIn: used.get(id) ?? [],
    site,
  }
}

// ── Create / open / duplicate ─────────────────────────────────────────────────

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new FaqSetError('invalid_value', 'Give the FAQ set a name.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new FaqSetError('invalid_value', 'Give the FAQ set a name.')
  if (name.length > FAQ_LIMITS.name) throw new FaqSetError('invalid_value', 'The name is too long.')
  return name
}

async function assertRoomForOneMore(client: Client, projectSlug: string) {
  const n = await client.fetch<number | null>(
    `count(*[_type == "faqSet" && projectSlug == $projectSlug && !(_id in path("versions.**"))])`,
    { projectSlug },
    RAW
  )
  if ((typeof n === 'number' ? n : 0) >= FAQ_LIMITS.sets * 2) throw new FaqSetError('too_large', 'This site has too many FAQ sets. Delete some first.')
}

/** A new, unpublished FAQ set (draft only), named. Write permission. */
export async function createFaqSet(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { name: string },
  deps: FaqDeps = {}
): Promise<{ id: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  return audited({ ctx, projectId, contentType: 'faqSet', contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const name = cleanName(input?.name)
    await assertRoomForOneMore(client, grant.projectSlug)
    const doc = { _id: `drafts.${id}`, _type: 'faqSet', projectSlug: grant.projectSlug, internalName: name, items: [] }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published set. A server action, never a GET. */
export async function openFaqSetForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: FaqDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const id = input?.id
  if (!isFaqSetId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (archivedAtOf(published)) throw new FaqSetError('archived', 'Restore this FAQ set to edit it.')
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'faqSet'
  copy.projectSlug = grant.projectSlug
  await singleProjectGuard(client, grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string }
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      // Someone else opened it a moment ago: adopt their draft.
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
      throw new FaqSetError('conflict', 'This FAQ set was changed elsewhere.')
    }
    throw new FaqSetError('failed', 'Could not open the FAQ set.')
  }
}

/** A new DRAFT set: this set's title, note and questions (fresh keys), attached nowhere (D4). */
export async function duplicateFaqSet(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; name: string },
  deps: FaqDeps = {}
): Promise<{ id: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  return audited({ ctx, projectId, contentType: 'faqSet', contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    if (!isFaqSetId(input?.id)) notFound()
    const name = cleanName(input?.name)
    const { published, draft } = await readPair(client, input.id, grant.projectSlug)
    const source = draft ?? published
    if (!source) notFound()
    await assertRoomForOneMore(client, grant.projectSlug)
    const used = new Set<string>()
    const fresh = (): string => {
      let k = (deps.newKey ?? (() => randomUUID().replace(/-/g, '').slice(0, 12)))()
      while (used.has(k)) k = (deps.newKey ?? (() => randomUUID().replace(/-/g, '').slice(0, 12)))()
      used.add(k)
      return k
    }
    const items = (Array.isArray(source.items) ? source.items : []).map((raw) => ({ ...(raw as Record<string, unknown>), _key: fresh() }))
    const note = typeof source.note === 'string' && source.note ? { note: source.note } : {}
    const title = source.title && typeof source.title === 'object' && Object.keys(localized(source.title)).length ? { title: source.title } : {}
    const doc: { _id: string; _type: string } & Record<string, unknown> = { _id: `drafts.${id}`, _type: 'faqSet', projectSlug: grant.projectSlug, internalName: name, ...title, ...note, items }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

// ── Patch ─────────────────────────────────────────────────────────────────────

const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/**
 * Rebuilds the items array from the client's ordered list. Keys kept when
 * valid and unique, else regenerated. Languages: the site's, plus any language
 * already stored in this draft (so a language removed from the site never
 * loses its text on a save). Existing `translationStatus` objects are carried
 * over untouched. Returns the NEW internal link ids (not stored before).
 */
function rebuildItems(value: unknown, allowed: Set<string>, stored: Doc | undefined, newKey: () => string): { items: Array<Record<string, unknown>>; newRefs: Set<string> } {
  if (!Array.isArray(value) || value.length > FAQ_LIMITS.items) {
    throw new FaqSetError('invalid_value', `A FAQ set holds up to ${FAQ_LIMITS.items} questions.`)
  }
  const storedByKey = new Map<string, Record<string, unknown>>()
  for (const raw of Array.isArray(stored?.items) ? (stored!.items as unknown[]) : []) {
    const s = objectOf(raw)
    if (s && typeof s._key === 'string') storedByKey.set(s._key, s)
  }
  const seen = new Set<string>()
  const newRefs = new Set<string>()
  const items = value.map((raw) => {
    const r = objectOf(raw)
    if (!r) throw new FaqSetError('invalid_value', 'Unknown question.')
    let key = typeof r._key === 'string' && KEY.test(r._key) && !seen.has(r._key) ? r._key : ''
    while (!key || seen.has(key)) key = newKey()
    seen.add(key)
    const before = typeof r._key === 'string' ? storedByKey.get(r._key) : undefined

    const question: Record<string, unknown> = { _type: 'localizedString' }
    const q = r.question === undefined || r.question === null ? {} : objectOf(r.question)
    if (!q) throw new FaqSetError('invalid_value', 'A question must be one text per language.')
    for (const [loc, v] of Object.entries(q)) {
      if (loc.startsWith('_')) continue
      if (!allowed.has(loc)) throw new FaqSetError('invalid_value', `Language "${loc}" is not on this site.`)
      if (typeof v !== 'string') throw new FaqSetError('invalid_value', 'A question must be text.')
      const t = v.trim().replace(/\s+/g, ' ')
      if (t.length > FAQ_LIMITS.question) throw new FaqSetError('invalid_value', 'A question is too long.')
      if (t) question[loc] = t
    }
    const qStatus = objectOf(before?.question)?.translationStatus
    if (qStatus !== undefined) question.translationStatus = qStatus

    const answer: Record<string, unknown> = { _type: 'faqAnswerText' }
    const a = r.answer === undefined || r.answer === null ? {} : objectOf(r.answer)
    if (!a) throw new FaqSetError('invalid_value', 'An answer must be one text per language.')
    const storedAnswer = objectOf(before?.answer)
    for (const [loc, v] of Object.entries(a)) {
      if (loc.startsWith('_')) continue
      if (!allowed.has(loc)) throw new FaqSetError('invalid_value', `Language "${loc}" is not on this site.`)
      let blocks: unknown[]
      try {
        blocks = sanitizeFaqAnswer(v, storedAnswer?.[loc])
      } catch (error) {
        if (error instanceof FaqAnswerError) throw new FaqSetError('invalid_value', error.message)
        throw error
      }
      if (!blocks.length) continue
      answer[loc] = blocks
      const storedRefs = collectInternalRefs(storedAnswer?.[loc])
      for (const ref of collectInternalRefs(blocks)) if (!storedRefs.has(ref)) newRefs.add(ref)
    }
    const aStatus = storedAnswer?.translationStatus
    if (aStatus !== undefined) answer.translationStatus = aStatus

    return { _key: key, _type: 'faqEntry', question, answer }
  })
  return { items, newRefs }
}

/** Validates and applies one autosave patch to `drafts.<id>`. Returns the new revision. */
export async function patchFaqSetDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: FaqDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isFaqSetId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new FaqSetError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new FaqSetError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > FAQ_LIMITS.patchBytes) throw new FaqSetError('too_large', 'Too much at once.')
  // Field allow-list before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const ok = path === 'internalName' || path === 'note' || path === 'items' || (field === 'title' && !!locale && rest.length === 0)
    if (!ok) throw new FaqSetError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, FaqSite, void]>([
    readPair(client, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (draft!._rev !== input.rev) throw new FaqSetError('conflict', 'This FAQ set was edited elsewhere.')
  if (archivedAtOf(published ?? draft)) throw new FaqSetError('archived', 'Restore this FAQ set to edit it.')

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  let newRefs = new Set<string>()
  for (const [path, value] of Object.entries(input.set)) {
    if (path === 'internalName') {
      set.internalName = cleanName(value)
      continue
    }
    if (path === 'note') {
      if (typeof value !== 'string' || value.length > FAQ_LIMITS.note) throw new FaqSetError('invalid_value', 'The note is too long or not text.')
      if (value.trim()) set.note = value.trim()
      else unset.push('note')
      continue
    }
    if (path === 'items') {
      const allowed = new Set(site.languages)
      for (const raw of Array.isArray(draft!.items) ? (draft!.items as unknown[]) : []) {
        const it = objectOf(raw)
        for (const part of [objectOf(it?.question), objectOf(it?.answer)]) for (const k of Object.keys(part ?? {})) if (LOCALE_KEY.test(k)) allowed.add(k)
      }
      const rebuilt = rebuildItems(value, allowed, draft, deps.newKey ?? (() => randomUUID().replace(/-/g, '').slice(0, 12)))
      set.items = rebuilt.items
      newRefs = rebuilt.newRefs
      continue
    }
    const locale = path.split('.')[1]
    if (!site.languages.includes(locale)) throw new FaqSetError('invalid_field', `Language "${locale}" is not on this site.`)
    if (typeof value !== 'string' || value.length > FAQ_LIMITS.title) throw new FaqSetError('invalid_value', `"${path}" is too long or not text.`)
    ensure.title = { _type: 'localizedString' }
    const t = value.trim().replace(/\s+/g, ' ')
    if (t) set[path] = t
    else unset.push(path)
  }

  // A NEW internal link must point at a link-target document of THIS project
  // (refs already stored are left alone). One read for the whole patch.
  if (newRefs.size) {
    const ids = [...newRefs]
    const found = await client.fetch<string[] | null>(`*[_id in $ids && _type in $types && projectSlug == $projectSlug]._id`, {
      ids,
      types: [...BODY_LINK_TARGET_TYPES],
      projectSlug: grant.projectSlug,
    })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!ids.every((x) => ok.has(x))) throw new FaqSetError('invalid_value', 'That link points to a page that is not on this website.')
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

/** Publishes `drafts.<id>` in one revision-guarded transaction. Returns the published revision. */
export async function publishFaqSetDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: FaqDeps = {}
): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: 'faqSet', contentId: isFaqSetId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isFaqSetId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new FaqSetError('conflict', 'Missing revision.')
      const { published, draft } = await readPair(client, input.id, grant.projectSlug)
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new FaqSetError('conflict', 'This FAQ set was edited elsewhere.')
      // Archived content cannot go back online by publishing (ADR-032): restore first.
      if (archivedAtOf(published ?? draft)) throw new FaqSetError('archived', 'Restore this FAQ set before publishing.')

      const doc: Record<string, unknown> = {}
      // Sets have no publication window (D2): lifecycle fields never travel from
      // the draft (an archive/restore leaves expiresAt on it), so publishing
      // can never take a set back off the website.
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = 'faqSet'
      doc.projectSlug = grant.projectSlug
      if (typeof doc.internalName !== 'string' || !doc.internalName.trim()) doc.internalName = 'FAQ set'
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
      // Sanity sets a touched document's revision to the transaction id.
      return { value: { rev: transactionId }, action: lifecycleAction(snapshotOf(published), state, 'optional', now), state }
    }
  )
}

/** Throws away unpublished changes of a published set. */
export async function discardFaqSetDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: FaqDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isFaqSetId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  // A never-published set has nothing to go back to: that is a delete.
  if (!published) throw new FaqSetError('invalid_value', 'This FAQ set was never published.')
  if (draft._rev !== input.rev) throw new FaqSetError('conflict', 'This FAQ set was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit()
  )
}

// ── Archive / restore / delete ────────────────────────────────────────────────

export const FAQ_LIFECYCLE_OPS = ['archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type FaqSetLifecycleOp = (typeof FAQ_LIFECYCLE_OPS)[number]

/**
 * Archive / restore / delete through the lifecycle service (ADR-032) with the
 * FAQ descriptor. `in_use` refusals carry where the set is used
 * (`detail.usedIn`). Returns the DRAFT's new revision (archive and restore also
 * touch the draft; null when there is no draft) so an open editor can adopt it.
 */
export async function runFaqSetLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: FaqSetLifecycleOp },
  deps: FaqDeps = {}
): Promise<{ rev: string | null }> {
  if (!(FAQ_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new FaqSetError('invalid_value', 'Unknown action.')
  // Gate before any read (the service re-checks the exact permission set).
  const grant = grantFor(ctx, projectId, FAQ_WRITE_PERMISSION)
  if (input.op === 'deletePermanently') grantFor(ctx, projectId, FAQ_DELETE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  const d = FAQ_SET_LIFECYCLE
  try {
    if (!isFaqSetId(input.id)) notFound()
    const { published, draft } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
    const args = { id: input.id, rev: (input.op === 'deleteDraft' ? draft?._rev : published?._rev) ?? '' }
    switch (input.op) {
      case 'archive': {
        const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        return { rev: r.draftRev }
      }
      case 'restore': {
        const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        // A set has no publication window (ADR-037 D2), but archive set
        // expiresAt = now and restore keeps it — the set would stay off the
        // website. Restoring a set puts it straight back online.
        // expiresAt has no meaning on a set, so it is removed unconditionally
        // (no read-back: a stale read could still look archived).
        const raw = (deps.client ?? sanityWriteClient) as Client
        const tx = await commit(raw, grant.projectSlug, () => {
          let t = raw.transaction().patch(input.id, { unset: ['expiresAt'] })
          if (draft) t = t.patch(`drafts.${input.id}`, { unset: ['expiresAt'] })
          return t.commit()
        }) as { transactionId?: string } | undefined
        // Touching the draft changes its revision again: hand the newest one back.
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
    if (error instanceof FaqSetError && error.code === 'in_use' && referrers?.length) {
      const site = await readSite(deps.client ?? sanityWriteClient, grant.projectSlug)
      const full = (await usage(deps.client ?? sanityWriteClient, grant.projectSlug, [input.id], site.defaultLocale)).get(input.id) ?? []
      const blocking = new Set(referrers.map((r) => r.id))
      const named = full.filter((u) => blocking.has(u.id))
      const usedIn: FaqSetUsage[] = named.length
        ? named
        : referrers.map((r) => ({ kind: r.type === 'post' ? ('post' as const) : ('page' as const), id: r.id, title: r.label, published: false }))
      throw new FaqSetError('in_use', error.message, { usedIn })
    }
    throw error
  }
}

// ── Activity ──────────────────────────────────────────────────────────────────

/** The set's Activity (ADR-032 D9). Read permission; the set must be this project's. */
export async function getFaqSetActivity(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: FaqDeps = {}
): Promise<ActivityItem[]> {
  const grant = grantFor(ctx, projectId, FAQ_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isFaqSetId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  return (deps.read ?? readContentActivity)({ projectId, contentType: 'faqSet', contentIds: [input.id] })
}

// ── Link targets for answers ──────────────────────────────────────────────────

/**
 * The link sheet's search for FAQ answers: the same targets as a post body
 * (pages, posts, news, events) plus Catalogue items and collections (D12).
 * Gate: faq.set.write (not the blog permission).
 */
export async function searchFaqLinkTargets(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { locale: unknown; query?: unknown; ids?: unknown },
  deps: Pick<FaqDeps, 'fetch'> = {}
): Promise<LinkTargetResult[]> {
  return searchLinkTargets(ctx, projectId, input, { ...deps, permission: FAQ_WRITE_PERMISSION, types: BODY_LINK_TARGET_TYPES })
}
