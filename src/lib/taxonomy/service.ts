/**
 * Taxonomy service — the dashboard's only writer of `taxonomyTerm` records
 * (ADR-033 Amendment J, J-4/J-5, slice 3). Server-only: it imports the
 * token-carrying Sanity write client.
 *
 * Every function, in this order:
 *   1. `assertModuleAction(ctx, projectId, '<module>.taxonomy.write')` — the
 *      module must be installed for the project AND the caller's role must
 *      grant the permission — before any I/O. Listing needs the module's read
 *      permission instead (viewers may choose a term, not add one).
 *   2. The module's manifest must declare the kind (`taxonomies`).
 *   3. Reads and writes use the project from the GRANT: queries go through
 *      `tenantScopedSanityClient` (forces `$projectSlug`), ids embed the
 *      project (`term.<project>.<module>.<kind>.<key>`), and a fetched record
 *      must still be a `taxonomyTerm` of this project/module/kind.
 *   4. `assertSingleSanityProject` runs before every mutation.
 *
 * Writes are immediate (the type is liveEdit): no drafts. Errors are
 * `TaxonomyError`s with opaque codes (the actions turn them into `Fail`).
 * `TenantAuthorizationError` passes through unchanged ('forbidden').
 *
 * Not here: reading terms for content (slice 2), the UI (slice 4).
 */
import { sameTagText, websiteLabel } from '@/lib/tag-text'
import { assertModuleAction, canModuleAction } from '@/lib/api/module-action-guard'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest, ModuleTaxonomyDef } from '@/lib/modules/types'
import { span } from '@/lib/perf/timing'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { isTermKind, isValidTermKey, SLUG_PART_PATTERN, TAXONOMY_TERM_TYPE, termId, termIdPartIssues, type TermKind } from './ids'
import {
  deriveRoutableTermKey,
  deriveTermKey,
  keyChangeIssue,
  labelIssues,
  nextOrder,
  ORDER_STEP,
  termIsRoutable,
  termLimitIssue,
  type Labels,
  type RuleIssue,
} from './rules'
import { buildUsageCountsQuery, buildUsageQuery, countUsageByKey, summarizeUsage, type UsageCountRow, type UsageRow } from './usage'
import { taxonomyReadPermission, taxonomyWritePermission } from './permissions'
import { summarizeCoverage, translationCoverage, type TranslationCoverage } from './coverage'

// ── Errors ────────────────────────────────────────────────────────────────────

export type TaxonomyErrorCode =
  /** The module does not declare this kind of term in its manifest. */
  | 'kind_not_declared'
  | 'invalid_value'
  | 'label_required'
  | 'label_too_long'
  | 'too_many_terms'
  | 'key_immutable'
  | 'not_found'
  /** The term changed since it was loaded (revision guard) or a concurrent write won. */
  | 'conflict'
  /** Delete refused: content still uses the term; `detail` names it. */
  | 'in_use'
  | 'failed'

export type TermUsageItem = { id: string; name: string; type: string }
export type TaxonomyErrorDetail = {
  /** in_use: how many items use the term, and the first 10 of them. */
  count?: number
  items?: TermUsageItem[]
  field?: string
}

export class TaxonomyError extends Error {
  constructor(
    readonly code: TaxonomyErrorCode,
    message: string,
    readonly detail?: TaxonomyErrorDetail
  ) {
    super(message)
    this.name = 'TaxonomyError'
  }
}

const RULE_CODES: Record<string, TaxonomyErrorCode> = {
  'label-required': 'label_required',
  'label-too-long': 'label_too_long',
  'too-many-terms': 'too_many_terms',
  'key-immutable': 'key_immutable',
  'key-invalid': 'invalid_value',
}
function throwIssue(issue: RuleIssue | undefined | null): void {
  if (issue) throw new TaxonomyError(RULE_CODES[issue.code] ?? 'invalid_value', issue.message)
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'createIfNotExists' | 'patch' | 'transaction' | 'delete'>
export type TaxonomyDeps = {
  client?: Client
  now?: () => Date
  /** Manifests to read `taxonomies` from (tests); defaults to the module registry. */
  registry?: readonly ModuleManifest[]
}

type TermDoc = {
  _id?: string
  _type?: string
  _rev?: string
  projectSlug?: string
  module?: string
  kind?: string
  key?: string
  label?: unknown
  color?: unknown
  order?: unknown
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
}

export type TermView = {
  id: string
  key: string
  label: Record<string, string>
  color: string | null
  order: number
  rev: string
  coverage: TranslationCoverage
}
export type ListedTerm = TermView & { usedBy: number }
export type TermList = {
  module: string
  kind: TermKind
  defaultLocale: string
  locales: string[]
  terms: ListedTerm[]
  summary: { needTranslation: number; total: number }
  /** UI hint; every write re-checks the permission server-side. */
  canWrite: boolean
  /** Whether this kind carries a badge colour. */
  color: boolean
}

const RAW = { perspective: 'raw' } as const
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const MAX_ATTEMPTS = 6
export const IN_USE_ITEM_LIMIT = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

export { taxonomyReadPermission, taxonomyWritePermission }

function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

const pickName = (value: unknown, locale: string): string => {
  if (typeof value === 'string') return value
  const v = localized(value)
  return v[locale] ?? Object.values(v)[0] ?? ''
}

type Access = { projectSlug: string; module: string; kind: TermKind; def: ModuleTaxonomyDef; canWrite: boolean }

/** Steps 1–2: permission (module installed + role), then the manifest declaration. No I/O. */
function authorize(
  ctx: TenantAuthorizationContext,
  projectId: string,
  module: unknown,
  kind: unknown,
  mode: 'read' | 'write',
  deps: TaxonomyDeps
): Access {
  if (typeof module !== 'string' || !SLUG_PART_PATTERN.test(module)) throw new TaxonomyError('invalid_value', 'Unknown module.')
  const registry = deps.registry ?? MODULE_REGISTRY
  const permission = mode === 'write' ? taxonomyWritePermission(module) : taxonomyReadPermission(module, registry)
  assertModuleAction(ctx, projectId, permission)
  if (!isTermKind(kind)) throw new TaxonomyError('invalid_value', 'Unknown kind.')
  const def = registry.find((m) => m.id === module)?.taxonomies?.find((t) => t.kind === kind)
  if (!def) throw new TaxonomyError('kind_not_declared', `The ${module} module has no ${kind}s.`)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  return { projectSlug: grant.projectSlug, module, kind, def, canWrite: mode === 'write' || canModuleAction(ctx, projectId, taxonomyWritePermission(module)) }
}

function idOf(a: Access, key: string): string {
  const parts = { projectSlug: a.projectSlug, module: a.module, kind: a.kind, key }
  if (termIdPartIssues(parts).length > 0) throw new TaxonomyError('invalid_value', 'Invalid term key.')
  return termId(parts)
}

function scopedClient(ctx: TenantAuthorizationContext, projectId: string, client: Client): TenantScopedSanityClient {
  return tenantScopedSanityClient(ctx, projectId, {
    fetch: <T>(query: string, params?: Record<string, unknown>) => client.fetch(query, params ?? {}, RAW) as Promise<T>,
  })
}

const singleProjectGuard = (client: Client, projectSlug: string) =>
  span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug))

type Site = { defaultLocale: string; locales: string[] }
const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
const TERMS_QUERY = /* groq */ `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == $module && kind == $kind && !(_id in path("drafts.**"))] | order(order asc, key asc){ _id, _type, _rev, projectSlug, module, kind, key, label, color, order, createdAt, createdBy }`

async function readSite(scoped: TenantScopedSanityClient): Promise<Site> {
  const r = await span('sanity.readSite', () => scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(SITE_QUERY))
  const supported = r?.supportedLocales?.length ? r.supportedLocales : []
  const defaultLocale = r?.defaultLocale || supported[0]
  if (!defaultLocale) throw new TaxonomyError('failed', 'Site languages are not configured.')
  return { defaultLocale, locales: [defaultLocale, ...supported.filter((l) => l !== defaultLocale)] }
}

const readTermDocs = (scoped: TenantScopedSanityClient, a: Access) =>
  span('sanity.readTerms', () => scoped.fetch<TermDoc[] | null>(TERMS_QUERY, { module: a.module, kind: a.kind })).then((rows) => rows ?? [])

/** A fetched record must still be a term of THIS project, module and kind. */
function isOurs(doc: TermDoc | null | undefined, a: Access): doc is TermDoc {
  return !!doc && doc._type === TAXONOMY_TERM_TYPE && doc.projectSlug === a.projectSlug && doc.module === a.module && doc.kind === a.kind && isValidTermKey(doc.key)
}

function view(doc: TermDoc, site: Site): TermView {
  const label = localized(doc.label)
  return {
    id: String(doc._id ?? ''),
    key: String(doc.key),
    label,
    color: typeof doc.color === 'string' && doc.color ? doc.color : null,
    order: typeof doc.order === 'number' && Number.isFinite(doc.order) ? doc.order : 0,
    rev: String(doc._rev ?? ''),
    coverage: translationCoverage(label, site.locales, site.defaultLocale),
  }
}

/** Trimmed labels in enabled languages only; an unknown language is refused. */
function cleanLabels(input: unknown, site: Site): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaxonomyError('label_required', 'A label is required.')
  const out: Record<string, string> = {}
  for (const [locale, raw] of Object.entries(input as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === '') continue
    if (typeof raw !== 'string') throw new TaxonomyError('invalid_value', 'Labels must be text.', { field: `label.${locale}` })
    if (!site.locales.includes(locale)) throw new TaxonomyError('invalid_value', `${locale} is not a language of this website.`, { field: `label.${locale}` })
    // The website-tag rule (lib/tag-text): the client's case, but no WORDS IN CAPITALS.
    const text = websiteLabel(raw)
    if (text) out[locale] = text
  }
  return out
}

function cleanColor(color: unknown, a: Access): string | null | undefined {
  if (color === undefined) return undefined
  if (!a.def.color) throw new TaxonomyError('invalid_value', 'These terms have no colour.', { field: 'color' })
  if (color === null || color === '') return null
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) throw new TaxonomyError('invalid_value', 'Use a colour like #1a2b3c.', { field: 'color' })
  return color.toLowerCase()
}

async function commit<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await span('sanity.commit', run)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new TaxonomyError('conflict', 'This was changed elsewhere.')
    throw new TaxonomyError('failed', 'Could not save.')
  }
}

const sameLabel = sameTagText

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * Terms of one module + kind with usage counts (draft, published and archived
 * items all count) and per-language translation coverage. Needs the module's
 * READ permission — viewers may list.
 */
export async function listTerms(ctx: TenantAuthorizationContext, projectId: string, module: string, kind: string, deps: TaxonomyDeps = {}): Promise<TermList> {
  const a = authorize(ctx, projectId, module, kind, 'read', deps)
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const counts = buildUsageCountsQuery(a.def.usedBy)
  const [site, docs, usageRows] = await readsInOrder([
    readSite(scoped),
    readTermDocs(scoped, a),
    span('sanity.readUsageCounts', () => scoped.fetch<UsageCountRow[] | null>(counts.query)),
  ] as const)
  const usage = countUsageByKey(usageRows ?? [])
  const terms = docs.filter((d) => isOurs(d, a)).map((d) => ({ ...view(d, site), usedBy: usage.get(String(d.key)) ?? 0 }))
  return {
    module: a.module,
    kind: a.kind,
    defaultLocale: site.defaultLocale,
    locales: site.locales,
    terms,
    summary: summarizeCoverage(terms.map((t) => t.coverage)),
    canWrite: a.canWrite,
    color: a.def.color === true,
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Creates a term from its default-language label (other languages optional).
 * The key is derived from that label; the id is deterministic and the write is
 * `createIfNotExists`, so two concurrent creates converge: the same label
 * yields ONE record (the second call gets it back, `created: false`), a
 * different label that lands on the same key is retried with the next suffix
 * (`_2`, `_3`, …). Returns the term, so inline creation can select it at once.
 */
export async function createTerm(
  ctx: TenantAuthorizationContext,
  projectId: string,
  module: string,
  kind: string,
  input: { labels: Labels; color?: string | null },
  deps: TaxonomyDeps = {}
): Promise<{ term: TermView; created: boolean }> {
  const a = authorize(ctx, projectId, module, kind, 'write', deps)
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const [site, existing] = await readsInOrder([readSite(scoped), readTermDocs(scoped, a), singleProjectGuard(client, a.projectSlug)] as const).then(([s, e]) => [s, e] as const)

  const labels = cleanLabels(input?.labels, site)
  for (const issue of labelIssues(labels, site.defaultLocale)) throwIssue(issue)
  const color = cleanColor(input?.color, a)
  const ours = existing.filter((d) => isOurs(d, a))
  throwIssue(termLimitIssue(ours.length))

  const defaultLabel = labels[site.defaultLocale]
  // Same label already there (any casing): hand that term back instead of a near-duplicate.
  const twin = ours.find((d) => sameLabel(localized(d.label)[site.defaultLocale], defaultLabel))
  if (twin) return { term: view(twin, site), created: false }

  const taken = ours.map((d) => String(d.key))
  const nowIso = (deps.now?.() ?? new Date()).toISOString()
  const order = nextOrder(ours.map((d) => (typeof d.order === 'number' ? d.order : NaN)))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const key = termIsRoutable(a.module, a.kind) ? deriveRoutableTermKey(defaultLabel, taken) : deriveTermKey(defaultLabel, taken)
    const doc = {
      _id: idOf(a, key),
      _type: TAXONOMY_TERM_TYPE,
      projectSlug: a.projectSlug,
      module: a.module,
      kind: a.kind,
      key,
      label: { _type: 'localizedString', ...labels },
      order,
      ...(color ? { color } : {}),
      createdAt: nowIso,
      createdBy: ctx.userId,
      updatedAt: nowIso,
      updatedBy: ctx.userId,
    }
    const stored = (await commit(() => client.createIfNotExists(doc))) as TermDoc
    if (!isOurs(stored, a) || stored.key !== key) throw new TaxonomyError('failed', 'Could not save.')
    if (sameLabel(localized(stored.label)[site.defaultLocale], defaultLabel)) {
      return { term: view(stored, site), created: stored.createdAt === nowIso && stored.createdBy === ctx.userId }
    }
    taken.push(key) // another term won this key → next suffix
  }
  throw new TaxonomyError('conflict', 'Could not find a free key. Try again.')
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Changes labels and colour of a term. The key is immutable: a different
 * `nextKey` is refused (`key_immutable`). `labels` entries are set per
 * language; an empty value removes that language (the default language cannot
 * be removed). `color: null` clears it. Guarded by `rev` when given, else by
 * the revision just read (`conflict` if the term changed in between).
 */
export async function updateTerm(
  ctx: TenantAuthorizationContext,
  projectId: string,
  module: string,
  kind: string,
  key: string,
  input: { labels?: Record<string, string | null | undefined>; color?: string | null; nextKey?: string; rev?: string },
  deps: TaxonomyDeps = {}
): Promise<{ term: TermView }> {
  const a = authorize(ctx, projectId, module, kind, 'write', deps)
  if (!isValidTermKey(key)) throw new TaxonomyError('invalid_value', 'Invalid term key.')
  throwIssue(keyChangeIssue(key, input?.nextKey))
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const id = idOf(a, key)
  const [site, current] = await readsInOrder([
    readSite(scoped),
    span('sanity.readTerm', () => client.getDocument(id) as Promise<TermDoc | undefined>),
    singleProjectGuard(client, a.projectSlug),
  ] as const).then(([s, d]) => [s, d] as const)
  if (!isOurs(current, a) || current.key !== key) throw new TaxonomyError('not_found', 'Unknown term.')

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  if (input?.labels !== undefined) {
    const changes = cleanLabels(input.labels, site)
    const removed = Object.entries(input.labels as Record<string, unknown>).filter(([, v]) => v === null || v === '').map(([l]) => l)
    const merged: Record<string, string> = { ...localized(current.label), ...changes }
    for (const locale of removed) delete merged[locale]
    for (const issue of labelIssues(merged, site.defaultLocale)) throwIssue(issue)
    set.label = { _type: 'localizedString', ...merged }
  }
  const color = cleanColor(input?.color, a)
  if (color === null) unset.push('color')
  else if (color !== undefined) set.color = color
  if (Object.keys(set).length === 0 && unset.length === 0) return { term: view(current, site) }

  set.updatedAt = (deps.now?.() ?? new Date()).toISOString()
  set.updatedBy = ctx.userId
  const rev = typeof input?.rev === 'string' && input.rev ? input.rev : current._rev
  const updated = (await commit(() => {
    let p = client.patch(id).ifRevisionId(String(rev)).set(set)
    if (unset.length) p = p.unset(unset)
    return p.commit()
  })) as TermDoc
  return { term: view({ ...current, ...set, ...(unset.includes('color') ? { color: undefined } : {}), _rev: updated?._rev ?? current._rev } as TermDoc, site) }
}

// ── Reorder ───────────────────────────────────────────────────────────────────

/**
 * Puts the listed keys first, in the given order; terms not listed (created
 * meanwhile) keep their relative order after them. Orders are spaced by
 * ORDER_STEP. Only terms whose position changed are written, in one transaction.
 */
export async function reorderTerms(
  ctx: TenantAuthorizationContext,
  projectId: string,
  module: string,
  kind: string,
  keys: readonly string[],
  deps: TaxonomyDeps = {}
): Promise<{ order: Array<{ key: string; order: number }> }> {
  const a = authorize(ctx, projectId, module, kind, 'write', deps)
  if (!Array.isArray(keys) || new Set(keys).size !== keys.length || !keys.every(isValidTermKey)) throw new TaxonomyError('invalid_value', 'Invalid order.')
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const [docs] = await readsInOrder([readTermDocs(scoped, a), singleProjectGuard(client, a.projectSlug)] as const).then(([d]) => [d] as const)
  const ours = docs.filter((d) => isOurs(d, a))
  const byKey = new Map(ours.map((d) => [String(d.key), d]))
  if (keys.some((k) => !byKey.has(k))) throw new TaxonomyError('not_found', 'Unknown term.')
  const sequence = [...keys, ...ours.map((d) => String(d.key)).filter((k) => !keys.includes(k))]
  const nowIso = (deps.now?.() ?? new Date()).toISOString()
  const order = sequence.map((key, i) => ({ key, order: (i + 1) * ORDER_STEP }))
  const changed = order.filter(({ key, order: o }) => byKey.get(key)!.order !== o)
  if (changed.length > 0) {
    await commit(() => {
      const tx = client.transaction()
      for (const { key, order: o } of changed) tx.patch(idOf(a, key), { set: { order: o, updatedAt: nowIso, updatedBy: ctx.userId } })
      return tx.commit()
    })
  }
  return { order }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Deletes an unused term. "Used" is decided server-side with the draft-including
 * perspective, so a draft-only or archived item still blocks: the refusal is
 * `in_use` with `detail: { count, items: first 10 {id, name, type} }`.
 * (A save landing between this check and the delete leaves an unknown key on
 * that item, which the resolver drops — a missing badge, never an error.)
 */
export async function deleteTerm(ctx: TenantAuthorizationContext, projectId: string, module: string, kind: string, key: string, deps: TaxonomyDeps = {}): Promise<{ key: string }> {
  const a = authorize(ctx, projectId, module, kind, 'write', deps)
  if (!isValidTermKey(key)) throw new TaxonomyError('invalid_value', 'Invalid term key.')
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const id = idOf(a, key)
  const usage = buildUsageQuery(a.def.usedBy, key)
  const [site, current, rows] = await readsInOrder([
    readSite(scoped),
    span('sanity.readTerm', () => client.getDocument(id) as Promise<TermDoc | undefined>),
    span('sanity.readUsage', () => scoped.fetch<UsageRow[] | null>(usage.query, usage.params)),
    singleProjectGuard(client, a.projectSlug),
  ] as const).then(([s, d, r]) => [s, d, r] as const)
  if (!isOurs(current, a) || current.key !== key) throw new TaxonomyError('not_found', 'Unknown term.')
  const used = summarizeUsage(rows ?? [])
  if (used.inUse) {
    throw new TaxonomyError('in_use', 'This term is still used.', {
      count: used.count,
      items: used.items.slice(0, IN_USE_ITEM_LIMIT).map((i) => ({ id: i.id, type: i.type, name: pickName(i.name, site.defaultLocale) })),
    })
  }
  await commit(() => client.delete(id))
  return { key }
}

// ── Usage (read-only) ─────────────────────────────────────────────────────────

/**
 * Where one term is used: how many items and the first 10 (draft, published and
 * archived all count). Same query and naming as the delete refusal, but with no
 * side effect, so the manager can show the list before anyone tries to delete.
 * Needs the module's READ permission.
 */
export async function termUsage(
  ctx: TenantAuthorizationContext,
  projectId: string,
  module: string,
  kind: string,
  key: string,
  deps: TaxonomyDeps = {}
): Promise<{ count: number; items: TermUsageItem[] }> {
  const a = authorize(ctx, projectId, module, kind, 'read', deps)
  if (!isValidTermKey(key)) throw new TaxonomyError('invalid_value', 'Invalid term key.')
  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  const usage = buildUsageQuery(a.def.usedBy, key)
  const [site, rows] = await readsInOrder([readSite(scoped), span('sanity.readUsage', () => scoped.fetch<UsageRow[] | null>(usage.query, usage.params))] as const).then(([s, r]) => [s, r] as const)
  const used = summarizeUsage(rows ?? [])
  return { count: used.count, items: used.items.slice(0, IN_USE_ITEM_LIMIT).map((i) => ({ id: i.id, type: i.type, name: pickName(i.name, site.defaultLocale) })) }
}
