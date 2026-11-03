/**
 * catalogueSettingsService — the ONE writer of the Catalogue installation's module config from
 * the dashboard (Catalogue → Setup is its only configuration surface: ADR-014, D-1, C9 R2 lock).
 * Server-only: it imports the token-carrying Sanity write client.
 *
 * Every operation, in this order:
 *   1. `assertCatalogueOperation(ctx, projectId, setup.*)` (= `catalogue.setup.manage`) before
 *      any I/O; `loadCatalogueSettings` needs only `catalogue.item.read` (the item editor may read
 *      whether setup was completed — never which pack, D-14).
 *   2. Reads through `tenantScopedSanityClient` (raw perspective), `assertSingleSanityProject`
 *      before any mutation.
 *   3. ONE key-level patch on the project document (`moduleInstallations[_key==…].config.<key>`),
 *      guarded by `ifRevisionID` = the revision the screen loaded (`rev`). A mismatch is
 *      `conflict` — never a silent overwrite (the Studio Modules pane may still toggle status).
 *   4. Channel changes are rule changes (C2 I-C2-4): `availabilityImpact` (C5-6) is computed and
 *      returned; a change with impact is written only with `confirmImpact: true`; each event is
 *      audited (`channel.activated` / `.deactivated` / `.default_changed`, C12). Channel REMOVAL
 *      is only `removeCatalogueChannel`: a counted, previewed, audited cleanup (D-21).
 *   5. Currency keeps the existing impact warning (ADR-033 D7): a change that reinterprets stored
 *      prices needs `confirmCurrency: true`. The public segment keeps the existing validation and
 *      its append-only history (ADR-033 C1/D11).
 * Transaction ids `abluo-setup-<op>-<id>`.
 */
import { randomUUID } from 'node:crypto'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { assertCatalogueCapabilities, assertCatalogueOperation, holdsCatalogueCapability } from '@/lib/api/catalogue-capability-guard'
import type { CatalogueOperation } from '@/lib/modules/catalogue/capabilities'
import { CONFIG_DATA_SOURCES, pageFirstSegments, type PageSlugRow } from '@/lib/modules/config-validators'
import { moduleConfigTypeName } from '@/lib/modules/config-schema'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { span } from '@/lib/perf/timing'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { catalogueTransactionId } from '@/lib/sanity/studio/catalogue-posture'
import { installationBase } from '@/lib/settings/disclosure-patch'
import { auditEntry, type CatalogueAuditEntry, type CatalogueAuditKind, type CatalogueAuditPayload, type ImpactCounts } from '../audit/events'
import { recordCatalogueActivity, type CatalogueAuditWriter } from '../audit/writer'
import { CATEGORY_RULES, availabilityInputsOf } from '../commerce/channel-availability'
import { channelListIssues, channelSetOf, channelUsage, readChannels, type Channel, type ChannelSet, type ChannelUsage } from '../commerce/channels'
import { availabilityImpact } from '../commerce/impact'
import type { FormatTemplate } from '../commerce/formats'
import type { ItemProfile } from '../profiles'
import { applySegmentChange, validateSegment, type SegmentClash } from '../segment'
import { CURRENCY_ITEM_PRICES_QUERY, CURRENCY_OPTION_DELTAS_QUERY, currencyChangeNeedsConfirmation, currencyChanged, currencyImpact, type CurrencyImpact, type ItemPriceRow, type OptionListRow } from '../validation'
import { availabilityItemsOf, ITEM_AVAILABILITY_QUERY, type ItemAvailabilityRow } from '../taxonomy/availability-items'
import { categoryRulesNaming, pruneChannelFromCategories, readCategoryTree, type CatalogueTaxonomyDeps } from '../taxonomy/service'
import { auditImpactCounts, scheduleSummary } from '../taxonomy/write-model'
import type { CategoryTree } from '../taxonomy/types'
import {
  channelEntries,
  channelEvents,
  channelSetWithOnly,
  channelsFromInput,
  dietaryTagsFromInput,
  formatTemplatesFromInput,
  parseLabel,
  parseProfile,
  removedValues,
  SETUP_SOURCES,
  type ChannelEvent,
  type SettingsIssue,
  type SetupSource,
} from './model'

export type CatalogueSettingsErrorCode =
  | 'catalogue_not_installed'
  /** The screen's copy is out of date (revision guard): reload. */
  | 'conflict'
  | 'invalid_input'
  | 'channel_invalid'
  /** A channel disappeared from the list: removal goes through removeCatalogueChannel (counted cleanup). */
  | 'channel_remove_needs_cleanup'
  | 'channel_unknown'
  /** The counted preview the person confirmed no longer matches: show the new counts. */
  | 'channel_usage_changed'
  /**
   * The stored channels predate C2 (no explicit default availability): writing explicit
   * defaults would end the legacy derivation of item availability (C10-4) before data step D2
   * writes the item rules. Setup edits channels once D2 has run for the project.
   */
  | 'channel_migration_pending'
  | 'segment_invalid'
  | 'currency_invalid'
  | 'dietary_in_use'
  | 'failed'

export type CatalogueSettingsErrorDetail = { issues?: readonly SettingsIssue[]; clash?: SegmentClash; usage?: ChannelUsage; count?: number; values?: readonly string[] }

export class CatalogueSettingsError extends Error {
  constructor(
    readonly code: CatalogueSettingsErrorCode,
    message: string,
    readonly detail?: CatalogueSettingsErrorDetail,
  ) {
    super(message)
    this.name = 'CatalogueSettingsError'
  }
}
const fail = (code: CatalogueSettingsErrorCode, message: string, detail?: CatalogueSettingsErrorDetail): never => {
  throw new CatalogueSettingsError(code, message, detail)
}

type Client = Pick<typeof sanityWriteClient, 'fetch' | 'transaction'>
export type CatalogueSettingsDeps = {
  client?: Client
  now?: () => Date
  uuid?: () => string
  audit?: CatalogueAuditWriter
  /** Passed to the taxonomy service for the tree and for pruning category rules. */
  taxonomy?: CatalogueTaxonomyDeps
}

const RAW = { perspective: 'raw' } as const
const REASSIGN_CHUNK = 100

const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
export const SETTINGS_PROJECT_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ _id, _rev, "inst": moduleInstallations[moduleId == "catalogue"][0]{ _key, enabled, config } }`
/** Every item document copy naming commerce rows (drafts included, versions excluded). */
export const ITEM_COMMERCE_QUERY = /* groq */ `*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, _rev, formats, offers, channelAvailability }`
export const ITEM_DIETARY_QUERY = /* groq */ `*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**")) && count(dietary[@ in $values]) > 0]._id`

type ProjectDoc = { _id: string; _rev: string; inst?: { _key?: string | null; enabled?: boolean | null; config?: Record<string, unknown> | null } | null } | null
type Site = { defaultLocale: string; locales: string[] }
type Access = { ctx: TenantAuthorizationContext; projectId: string; projectSlug: string; client: Client; scoped: TenantScopedSanityClient; deps: CatalogueSettingsDeps }

function open(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueSettingsDeps): Access {
  const client = deps.client ?? sanityWriteClient
  const scoped = tenantScopedSanityClient(ctx, projectId, {
    fetch: <T>(query: string, params?: Record<string, unknown>) => client.fetch(query, params ?? {}, RAW) as Promise<T>,
  })
  return { ctx, projectId, projectSlug: scoped.projectSlug, client, scoped, deps }
}

async function readBase(a: Access): Promise<{ site: Site; project: NonNullable<ProjectDoc>; config: Record<string, unknown> }> {
  const [site, project] = await Promise.all([
    span('sanity.readSite', () => a.scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(SITE_QUERY)),
    span('sanity.readProject', () => a.scoped.fetch<ProjectDoc>(SETTINGS_PROJECT_QUERY)),
  ])
  const grant = a.ctx.projects.find((p) => p.projectId === a.projectId)!
  if (!project?.inst || project.inst.enabled === false || !grant.enabledModuleIds.includes('catalogue')) fail('catalogue_not_installed', 'The Catalogue is not installed.')
  const supported = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || supported[0] || 'en'
  return { site: { defaultLocale, locales: [defaultLocale, ...supported.filter((l) => l !== defaultLocale)] }, project: project!, config: (project!.inst!.config ?? {}) as Record<string, unknown> }
}

const now = (a: Access) => (a.deps.now?.() ?? new Date()).toISOString()
const txId = (a: Access, op: string) => catalogueTransactionId('setup', `${op}-${(a.deps.uuid ?? randomUUID)().replace(/-/g, '').slice(0, 32)}`)
const isConflict = (e: unknown): boolean => {
  const x = e as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return x?.statusCode === 409 || x?.response?.statusCode === 409 || /revision/i.test(String(x?.message ?? ''))
}
const singleProject = (a: Access) => span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => a.client.fetch(q, p), a.projectSlug))
const catalogueManifest = () => MODULE_REGISTRY.find((m) => m.id === 'catalogue')!

/** The key-level patch for config keys of the Catalogue installation (a missing config object is created in the same set). */
export function configKeysPatch(inst: { _key?: string | null }, hasConfig: boolean, set: Record<string, unknown>, unset: readonly string[]): { set: Record<string, unknown>; unset: string[] } {
  const base = `${installationBase({ _key: inst._key ?? null })}.config`
  if (!hasConfig) {
    const config: Record<string, unknown> = { _type: moduleConfigTypeName(catalogueManifest()) }
    for (const [k, v] of Object.entries(set)) config[k] = v
    return { set: Object.keys(set).length ? { [base]: config } : {}, unset: [] }
  }
  return { set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`${base}.${k}`, v])), unset: unset.map((k) => `${base}.${k}`) }
}

async function commitConfig(a: Access, project: NonNullable<ProjectDoc>, rev: unknown, op: string, set: Record<string, unknown>, unset: readonly string[]): Promise<{ transactionId: string | null; rev: string }> {
  if (typeof rev !== 'string' || !rev) fail('invalid_input', 'Missing revision.')
  if (rev !== project._rev) fail('conflict', 'This was changed elsewhere.')
  if (Object.keys(set).length === 0 && unset.length === 0) return { transactionId: null, rev: project._rev }
  const patch = configKeysPatch(project.inst!, !!project.inst!.config, set, unset)
  const transactionId = txId(a, op)
  try {
    await span('sanity.commit', () =>
      a.client
        .transaction()
        .patch(project._id, { ifRevisionID: rev as string, ...(Object.keys(patch.set).length && { set: patch.set }), ...(patch.unset.length && { unset: patch.unset }) })
        .commit({ transactionId }),
    )
  } catch (error) {
    fail(isConflict(error) ? 'conflict' : 'failed', isConflict(error) ? 'This was changed elsewhere.' : 'Could not save.')
  }
  const after = await a.scoped.fetch<ProjectDoc>(SETTINGS_PROJECT_QUERY)
  return { transactionId, rev: after?._rev ?? '' }
}

async function audit<K extends CatalogueAuditKind>(a: Access, kind: K, transactionId: string | null, targetId: string, detail: CatalogueAuditPayload[K]): Promise<void> {
  const entry: CatalogueAuditEntry = auditEntry(kind, { projectId: a.projectId, targetId, actor: { kind: 'user', id: a.ctx.userId, support: !!a.ctx.support }, ...(transactionId && { transactionId }), detail })
  try {
    await (a.deps.audit ?? ((e: CatalogueAuditEntry) => recordCatalogueActivity(e)))(entry)
  } catch {
    /* never breaks the action */
  }
}

// ── View ──────────────────────────────────────────────────────────────────────

export type CatalogueSettingsView = {
  /** The project document's revision — pass back on every write. */
  rev: string
  defaultLocale: string
  locales: string[]
  channels: Array<Pick<Channel, 'key' | 'label' | 'active' | 'defaultAvailability' | 'defaultSchedule' | 'explicitDefault'>>
  currency: string | null
  publicSegment: string | null
  publicSegmentHistory: string[]
  publicName: Record<string, string>
  defaultItemProfile: ItemProfile | null
  showPricesByDefault: boolean
  formatTemplates: Array<{ key: string; label: Record<string, string>; quantity: { value: number; unit: string } | null }>
  dietaryTags: Array<{ value: string; label: Record<string, string> }>
  /** D-14: whether setup was completed (anyone with item.read) and how (setup.manage only) — never which pack. */
  setup: { completedAt: string | null; source: SetupSource | null }
  can: { manage: boolean }
}

const strMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => !k.startsWith('_') && k !== 'translationStatus' && typeof x === 'string' && x.trim())) as Record<string, string> : {}
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function settingsViewOf(config: Record<string, unknown>, site: Site, rev: string, canManage: boolean): CatalogueSettingsView {
  const channels = readChannels(config.serviceChannels).channels.all
  const source = SETUP_SOURCES.includes(config.setupSource as SetupSource) ? (config.setupSource as SetupSource) : null
  return {
    rev,
    defaultLocale: site.defaultLocale,
    locales: site.locales,
    channels: channels.map((c) => ({ key: c.key, label: c.label, active: c.active, defaultAvailability: c.defaultAvailability, defaultSchedule: c.defaultSchedule, explicitDefault: c.explicitDefault })),
    currency: typeof config.currency === 'string' ? config.currency : null,
    publicSegment: typeof config.publicSegment === 'string' ? config.publicSegment : null,
    publicSegmentHistory: strList(config.publicSegmentHistory),
    publicName: strMap(config.publicName),
    defaultItemProfile: parseProfile(config.defaultItemProfile).ok ? ((config.defaultItemProfile as ItemProfile) ?? null) : null,
    showPricesByDefault: config.showPricesByDefault !== false,
    formatTemplates: (Array.isArray(config.formatTemplates) ? (config.formatTemplates as Partial<FormatTemplate & { quantity: { value: number; unit: string } }>[]) : []).flatMap((t) =>
      t && typeof t.key === 'string' ? [{ key: t.key, label: strMap(t.label), quantity: t.quantity && typeof t.quantity.value === 'number' ? { value: t.quantity.value, unit: String(t.quantity.unit) } : null }] : [],
    ),
    dietaryTags: (Array.isArray(config.dietaryTags) ? (config.dietaryTags as Array<{ value?: unknown; label?: unknown }>) : []).flatMap((e) => (e && typeof e.value === 'string' ? [{ value: e.value, label: strMap(e.label) }] : [])),
    // D-14 / C7.9: whether setup was completed is readable by the item editor; HOW only by Setup.
    setup: { completedAt: typeof config.setupCompletedAt === 'string' && config.setupCompletedAt ? config.setupCompletedAt : null, source: canManage ? source : null },
    can: { manage: canManage },
  }
}

export async function loadCatalogueSettings(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueSettingsDeps = {}): Promise<CatalogueSettingsView> {
  assertCatalogueCapabilities(ctx, projectId, ['catalogue.item.read'])
  const a = open(ctx, projectId, deps)
  const { site, project, config } = await readBase(a)
  return settingsViewOf(config, site, project._rev, holdsCatalogueCapability(ctx, projectId, 'catalogue.setup.manage'))
}

// ── Channels (C2) ────────────────────────────────────────────────────────────

export type ChannelChange = { kind: ChannelEvent['kind']; channelKey: string; impact: ImpactCounts }
export type SaveChannelsResult = { saved: boolean; changes: ChannelChange[]; rev: string }

async function availabilityRows(a: Access): Promise<ItemAvailabilityRow[]> {
  return (await span('sanity.readItemAvailability', () => a.scoped.fetch<ItemAvailabilityRow[] | null>(ITEM_AVAILABILITY_QUERY))) ?? []
}

function impactOf(rows: readonly ItemAvailabilityRow[], tree: CategoryTree, before: ChannelSet, after: ChannelSet): ImpactCounts {
  const taxonomy = { tree, category: CATEGORY_RULES }
  // Items are read once with the BEFORE channel set (legacy derivation is a property of the stored data, C10-4).
  const items = availabilityItemsOf(rows, tree, before)
  return auditImpactCounts(availabilityImpact(availabilityInputsOf(before, taxonomy), availabilityInputsOf(after, taxonomy), items))
}

/**
 * The whole channel list as Setup edits it: order, labels, active, default availability and
 * default schedule; new channels appended. Removing a channel is refused here
 * (`channel_remove_needs_cleanup`). Every activation, deactivation or default change is a rule
 * change: its impact is returned, and with any impact the list is written only when
 * `confirmImpact` is true (otherwise `saved: false` = the confirmation to show).
 */
export async function saveCatalogueChannels(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { rev: string; channels: unknown; confirmImpact?: boolean },
  deps: CatalogueSettingsDeps = {},
): Promise<SaveChannelsResult> {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.channels' })
  const a = open(ctx, projectId, deps)
  await singleProject(a)
  const { site, project, config } = await readBase(a)
  const stored = readChannels(config.serviceChannels).channels
  if (stored.unmigrated) fail('channel_migration_pending', 'Channels can be edited once the Catalogue data update has run.')
  const previous = stored.all
  const parsed = channelsFromInput(input?.channels, previous, site)
  if (parsed.issues.length > 0) fail('channel_invalid', 'Check the channels.', { issues: parsed.issues })
  const next = parsed.channels
  const gone = previous.filter((p) => !next.some((n) => n.key === p.key))
  if (gone.length > 0) fail('channel_remove_needs_cleanup', 'Remove a channel with its cleanup.', { values: gone.map((g) => g.key) })
  const issues = channelListIssues(next, previous, { defaultLocale: site.defaultLocale }).filter((i) => i.level === 'error')
  if (issues.length > 0) fail('channel_invalid', 'Check the channels.', { issues: issues.map((i) => ({ field: 'channels', code: i.code, index: i.index, key: i.key })) })

  const events = channelEvents(previous, next)
  const changes: ChannelChange[] = []
  if (events.length > 0) {
    const [tree, rows] = await Promise.all([readCategoryTree(ctx, projectId, deps.taxonomy), availabilityRows(a)])
    const before = channelSetOf(previous)
    for (const e of events) changes.push({ kind: e.kind, channelKey: e.channelKey, impact: impactOf(rows, tree, before, channelSetWithOnly(previous, next, e.channelKey)) })
  }
  const hasImpact = changes.some((c) => c.impact.items > 0 || c.impact.formats > 0 || c.impact.shieldedByOverride > 0)
  if (hasImpact && input.confirmImpact !== true) return { saved: false, changes, rev: project._rev }

  const unchanged = JSON.stringify(channelEntries(next, config.serviceChannels)) === JSON.stringify(config.serviceChannels ?? [])
  const result = unchanged ? { transactionId: null, rev: project._rev } : await commitConfig(a, project, input.rev, 'channels', { serviceChannels: channelEntries(next, config.serviceChannels) }, [])
  for (const e of events) {
    const impact = changes.find((c) => c.kind === e.kind && c.channelKey === e.channelKey)!.impact
    if (e.kind === 'channel.activated') await audit(a, 'channel.activated', result.transactionId, e.channelKey, { channelKey: e.channelKey, defaultAvailability: e.defaultAvailability, impact })
    else if (e.kind === 'channel.deactivated') await audit(a, 'channel.deactivated', result.transactionId, e.channelKey, { channelKey: e.channelKey, impact })
    else await audit(a, 'channel.default_changed', result.transactionId, e.channelKey, { channelKey: e.channelKey, before: scheduleSummary({ state: e.before.defaultAvailability, overrides: e.before.defaultSchedule }), after: scheduleSummary({ state: e.after.defaultAvailability, overrides: e.after.defaultSchedule }), impact })
  }
  return { saved: true, changes, rev: result.rev }
}

type ItemCommerceRow = { _id: string; _rev?: string; formats?: unknown; offers?: unknown; channelAvailability?: unknown }

/** Every price row and availability row (items, formats, categories) naming the channel, drafts included (C2 channelUsage). */
async function usageOf(a: Access, ctx: TenantAuthorizationContext, projectId: string, key: string, deps: CatalogueSettingsDeps): Promise<{ usage: ChannelUsage; rows: ItemCommerceRow[] }> {
  const [rows, tree] = await Promise.all([a.scoped.fetch<ItemCommerceRow[] | null>(ITEM_COMMERCE_QUERY).then((r) => r ?? []), readCategoryTree(ctx, projectId, deps.taxonomy)])
  const usage = channelUsage(key as never, { items: rows })
  return { usage: { ...usage, categoryRules: categoryRulesNaming(tree, key) }, rows }
}

/** Counted preview of removing a channel: how many prices and rules the cleanup would remove. Nothing written. */
export async function previewCatalogueChannelRemoval(ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueSettingsDeps = {}): Promise<{ key: string; usage: ChannelUsage }> {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.channels' })
  const a = open(ctx, projectId, deps)
  const { config } = await readBase(a)
  if (!readChannels(config.serviceChannels).channels.byKey.has(input?.key as never)) fail('channel_unknown', 'Unknown channel.')
  return { key: input.key, usage: (await usageOf(a, ctx, projectId, input.key, deps)).usage }
}

const without = (rows: unknown, key: string) => (Array.isArray(rows) ? rows.filter((r) => !(r && typeof r === 'object' && ((r as { channel?: unknown }).channel === key || (r as { _key?: unknown })._key === key))) : rows)

/** The item-side cleanup of one document: price rows, item and format rules naming the channel; legacy offers naming it. Shape kept as stored. */
export function cleanupItemCommerce(row: ItemCommerceRow, key: string): { set: Record<string, unknown>; changed: boolean } {
  const set: Record<string, unknown> = {}
  if (Array.isArray(row.formats)) {
    const formats = (row.formats as Record<string, unknown>[]).map((f) => ({ ...f, prices: (Array.isArray(f.prices) ? f.prices : []).filter((p) => (p as { channel?: unknown })?.channel !== key), ...(Array.isArray(f.channelAvailability) && { channelAvailability: without(f.channelAvailability, key) }) }))
    if (JSON.stringify(formats) !== JSON.stringify(row.formats)) set.formats = formats
  }
  if (Array.isArray(row.channelAvailability)) {
    const rules = without(row.channelAvailability, key)
    if (JSON.stringify(rules) !== JSON.stringify(row.channelAvailability)) set.channelAvailability = rules
  }
  if (Array.isArray(row.offers)) {
    const offers = (row.offers as Record<string, unknown>[]).filter((o) => o?.channel !== key)
    if (offers.length !== row.offers.length) set.offers = offers
  }
  return { set, changed: Object.keys(set).length > 0 }
}

/**
 * "Remove channel and its N prices and M rules" (C2 I-C2-2, D-21). `expected` is the usage the
 * person confirmed (previewCatalogueChannelRemoval); if the data changed meanwhile nothing is
 * written and the new counts are returned (`channel_usage_changed`). Then: item documents in
 * chunks (drafts included), category rules (through the taxonomy service — its single writer),
 * and the entry itself in one guarded config patch; audited as `channel.removed`.
 */
export async function removeCatalogueChannel(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { rev: string; key: string; expected: ChannelUsage },
  deps: CatalogueSettingsDeps = {},
): Promise<{ key: string; cleanup: ChannelUsage; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.channels' })
  const a = open(ctx, projectId, deps)
  await singleProject(a)
  const { project, config } = await readBase(a)
  if (typeof input?.rev !== 'string' || input.rev !== project._rev) fail('conflict', 'This was changed elsewhere.')
  const channels = readChannels(config.serviceChannels).channels
  if (channels.unmigrated) fail('channel_migration_pending', 'Channels can be edited once the Catalogue data update has run.')
  if (!channels.byKey.has(input.key as never)) fail('channel_unknown', 'Unknown channel.')
  const { usage, rows } = await usageOf(a, ctx, projectId, input.key, deps)
  if (JSON.stringify(usage) !== JSON.stringify({ prices: input.expected?.prices, itemRules: input.expected?.itemRules, formatRules: input.expected?.formatRules, categoryRules: input.expected?.categoryRules })) {
    fail('channel_usage_changed', 'The counts changed. Check them again.', { usage })
  }
  const patches = rows.map((r) => ({ row: r, ...cleanupItemCommerce(r, input.key) })).filter((p) => p.changed)
  for (let i = 0; i < patches.length; i += REASSIGN_CHUNK) {
    const tx = a.client.transaction()
    for (const p of patches.slice(i, i + REASSIGN_CHUNK)) tx.patch(p.row._id, { ...(p.row._rev && { ifRevisionID: p.row._rev }), set: p.set })
    try {
      await span('sanity.channelCleanup', () => tx.commit({ transactionId: txId(a, 'channelCleanup') }))
    } catch (error) {
      fail(isConflict(error) ? 'channel_usage_changed' : 'failed', 'Some items changed meanwhile. Try again.')
    }
  }
  if (usage.categoryRules > 0) await pruneChannelFromCategories(ctx, projectId, input.key, deps.taxonomy)
  const remaining = channels.all.filter((c) => c.key !== input.key)
  const result = await commitConfig(a, project, input.rev, 'channelRemove', { serviceChannels: channelEntries(remaining, config.serviceChannels) }, [])
  await audit(a, 'channel.removed', result.transactionId, input.key, { channelKey: input.key, cleanup: { categoryRules: usage.categoryRules, itemRules: usage.itemRules, formatRules: usage.formatRules, prices: usage.prices } })
  return { key: input.key, cleanup: usage, rev: result.rev }
}

// ── Other settings ───────────────────────────────────────────────────────────

export type SettingsSet = Partial<{
  currency: string
  publicSegment: string
  publicName: Record<string, string | null>
  defaultItemProfile: ItemProfile | null
  showPricesByDefault: boolean
  formatTemplates: unknown[]
  dietaryTags: unknown[]
}>
export type SaveSettingsResult = { saved: boolean; rev: string; confirmation?: { currency: CurrencyImpact & { from: string; to: string } }; notices?: { segmentRevert?: string } }

const OP_FOR: Record<keyof SettingsSet, CatalogueOperation> = {
  currency: { op: 'setup.currency' },
  publicSegment: { op: 'setup.publicWebsite' },
  publicName: { op: 'setup.publicWebsite' },
  defaultItemProfile: { op: 'setup.defaults' },
  showPricesByDefault: { op: 'setup.defaults' },
  formatTemplates: { op: 'setup.defaults' },
  dietaryTags: { op: 'setup.defaults' },
}

/**
 * Short Catalogue settings in one guarded patch. Keys: currency (ADR-033 D7 warning:
 * `confirmCurrency` required when stored prices are reinterpreted; never converts),
 * publicSegment (existing segment validation + append-only history), publicName (C11, per
 * language; empty removes), defaultItemProfile, showPricesByDefault, formatTemplates (C3-6),
 * dietaryTags (a value still used by items cannot be removed).
 */
export async function saveCatalogueSettings(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { rev: string; set: SettingsSet; confirmCurrency?: boolean },
  deps: CatalogueSettingsDeps = {},
): Promise<SaveSettingsResult> {
  const set = (input?.set ?? {}) as SettingsSet
  const keys = Object.keys(set) as (keyof SettingsSet)[]
  if (keys.length === 0 || keys.some((k) => !(k in OP_FOR))) fail('invalid_input', 'Nothing to save.', { issues: keys.filter((k) => !(k in OP_FOR)).map((k) => ({ field: String(k), code: 'unknownField' })) })
  assertCatalogueOperation(ctx, projectId, keys.map((k) => OP_FOR[k]))
  const a = open(ctx, projectId, deps)
  await singleProject(a)
  const { site, project, config } = await readBase(a)
  const out: Record<string, unknown> = {}
  const unset: string[] = []
  const notices: SaveSettingsResult['notices'] = {}

  if (set.currency !== undefined) {
    const field = catalogueManifest().platformContract.configSchema.find((f) => f.id === 'currency')
    const to = typeof set.currency === 'string' ? set.currency.trim().toUpperCase() : ''
    if (!field?.options?.some((o) => o.value === to)) fail('currency_invalid', 'Unknown currency.')
    const from = typeof config.currency === 'string' ? config.currency : ''
    if (currencyChanged(from, to)) {
      if (from) {
        const [items, lists] = await Promise.all([a.scoped.fetch<ItemPriceRow[] | null>(CURRENCY_ITEM_PRICES_QUERY), a.scoped.fetch<OptionListRow[] | null>(CURRENCY_OPTION_DELTAS_QUERY)])
        const impact = currencyImpact(items ?? [], lists ?? [])
        if (currencyChangeNeedsConfirmation(impact) && input.confirmCurrency !== true) return { saved: false, rev: project._rev, confirmation: { currency: { ...impact, from, to } } }
      }
      out.currency = to
    }
  }
  if (set.publicSegment !== undefined) {
    const current = typeof config.publicSegment === 'string' ? config.publicSegment : ''
    const history = strList(config.publicSegmentHistory)
    const next = typeof set.publicSegment === 'string' ? set.publicSegment.trim() : ''
    if (next !== current) {
      const pages = (await a.scoped.fetch<PageSlugRow[] | null>(CONFIG_DATA_SOURCES.pageSlugs.query)) ?? []
      const v = validateSegment(next, { pageFirstSegments: pageFirstSegments(pages), history })
      if (!v.ok) fail('segment_invalid', 'Choose another web address.', { clash: v.clash })
      if (v.ok && v.revert) notices.segmentRevert = v.segment
      const applied = applySegmentChange(current, history, next)
      out.publicSegment = applied.segment
      out.publicSegmentHistory = applied.history
    }
  }
  if (set.publicName !== undefined) {
    const merged = { ...strMap(config.publicName) }
    for (const [l, v] of Object.entries(set.publicName ?? {})) if (v === null || v === '') delete merged[l]
    const parsed = parseLabel({ ...merged, ...Object.fromEntries(Object.entries(set.publicName ?? {}).filter(([, v]) => typeof v === 'string' && v !== '')) }, site, 'publicName', false)
    if (!parsed.ok) fail('invalid_input', 'Check the public name.', { issues: [parsed.issue] })
    if (parsed.ok) {
      if (Object.keys(parsed.value).length === 0) unset.push('publicName')
      else out.publicName = { _type: 'localizedString', ...parsed.value }
    }
  }
  if (set.defaultItemProfile !== undefined) {
    const p = parseProfile(set.defaultItemProfile)
    if (!p.ok) fail('invalid_input', 'Unknown item profile.', { issues: [{ field: 'defaultItemProfile', code: 'invalid' }] })
    if (p.ok && p.value === null) unset.push('defaultItemProfile')
    else if (p.ok) out.defaultItemProfile = p.value
  }
  if (set.showPricesByDefault !== undefined) {
    if (typeof set.showPricesByDefault !== 'boolean') fail('invalid_input', 'Invalid value.', { issues: [{ field: 'showPricesByDefault', code: 'invalid' }] })
    out.showPricesByDefault = set.showPricesByDefault
  }
  if (set.formatTemplates !== undefined) {
    const t = formatTemplatesFromInput(set.formatTemplates, site)
    if (t.issues.length > 0) fail('invalid_input', 'Check the format templates.', { issues: t.issues })
    if (t.value.length === 0) unset.push('formatTemplates')
    else out.formatTemplates = t.value
  }
  if (set.dietaryTags !== undefined) {
    const d = dietaryTagsFromInput(set.dietaryTags, config.dietaryTags, site)
    if (d.issues.length > 0) fail('invalid_input', 'Check the dietary tags.', { issues: d.issues })
    const removed = removedValues(config.dietaryTags, d.value)
    if (removed.length > 0) {
      const used = (await a.scoped.fetch<string[] | null>(ITEM_DIETARY_QUERY, { values: removed })) ?? []
      const items = new Set(used.map((id) => (id.startsWith('drafts.') ? id.slice(7) : id)))
      if (items.size > 0) fail('dietary_in_use', 'Some dietary tags are still used by items.', { count: items.size, values: removed })
    }
    if (d.value.length === 0) unset.push('dietaryTags')
    else out.dietaryTags = d.value
  }

  const result = await commitConfig(a, project, input.rev, 'settings', out, unset)
  return { saved: true, rev: result.rev, ...(Object.keys(notices).length > 0 && { notices }) }
}

/**
 * D-14 / C7.9 — record that Setup is complete (starting empty, deliberately marking it, or after a
 * pack). Stored separately from pack history; an already-completed setup is left as it is.
 */
export async function completeCatalogueSetup(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { rev: string; source: SetupSource },
  deps: CatalogueSettingsDeps = {},
): Promise<{ completedAt: string; source: SetupSource; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: input?.source === 'pack' ? 'setup.applyPack' : 'setup.defaults' })
  if (!SETUP_SOURCES.includes(input?.source)) fail('invalid_input', 'Unknown source.', { issues: [{ field: 'source', code: 'invalid' }] })
  const a = open(ctx, projectId, deps)
  await singleProject(a)
  const { project, config } = await readBase(a)
  if (typeof config.setupCompletedAt === 'string' && config.setupCompletedAt) {
    return { completedAt: config.setupCompletedAt, source: (SETUP_SOURCES.includes(config.setupSource as SetupSource) ? config.setupSource : input.source) as SetupSource, rev: project._rev }
  }
  const completedAt = now(a)
  const result = await commitConfig(a, project, input.rev, 'setupComplete', { setupCompletedAt: completedAt, setupSource: input.source }, [])
  return { completedAt, source: input.source, rev: result.rev }
}
