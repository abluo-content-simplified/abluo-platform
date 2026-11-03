/**
 * catalogueSettingsService (C2, C3-6, C11, D-1, D-14, C8 P-04/P-17) — one guarded, key-level
 * writer of the Catalogue module config; channel changes are confirmed rule changes with impact
 * and audit rows; channel removal only as a counted cleanup; currency and segment keep their
 * existing guards. Sanity is an in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { CatalogueForbidden } from '@/lib/api/catalogue-capability-guard'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { CatalogueAuditEntry } from '../../audit/events'
import { validateAuditDetail } from '../../audit/events'
import {
  CatalogueSettingsError,
  completeCatalogueSetup,
  configKeysPatch,
  loadCatalogueSettings,
  previewCatalogueChannelRemoval,
  removeCatalogueChannel,
  saveCatalogueChannels,
  saveCatalogueSettings,
  type CatalogueSettingsDeps,
} from '../service'
import { channelEvents, channelsFromInput } from '../model'
import { readChannels } from '../../commerce/channels'

const SLUG = 'trattoria'
const OWNER = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.taxonomy.write', 'catalogue.setup.manage']
const EDITOR = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.taxonomy.write']
const grant = (permissions = OWNER, o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role: 'owner',
  permissions,
  enabledModuleIds: ['catalogue'],
  ...o,
})
const ctxOf = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const owner = () => ctxOf(grant())
const editor = () => ctxOf(grant(EDITOR, { role: 'editor' }))
const P = 'project-a'

type Doc = Record<string, unknown> & { _id: string }
const DINE = { _key: 'c1', _type: 'serviceChannelsEntry', value: 'dine-in', label: { _type: 'localizedString', en: 'Dine-in' }, active: true, defaultAvailability: 'available' }
const DELIVERY = { _key: 'c2', _type: 'serviceChannelsEntry', value: 'delivery', label: { _type: 'localizedString', en: 'Delivery' }, active: false, defaultAvailability: 'unavailable' }
const projectDoc = (config: Record<string, unknown> | null = { serviceChannels: [DINE, DELIVERY], currency: 'EUR', publicSegment: 'menu' }): Doc => ({
  _id: 'project-doc',
  _type: 'project',
  projectSlug: SLUG,
  moduleInstallations: [{ _key: 'inst1', moduleId: 'catalogue', enabled: true, ...(config && { config: { _type: 'catalogueModuleConfig', ...config } }) }],
})
const fmt = (prices: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ({ _key: 'default', _type: 'catalogueFormat', prices, ...extra })
const item = (id: string, f: Record<string, unknown>): Doc => ({ _id: id, _type: 'catalogueItem', projectSlug: SLUG, ...f })

function fake(seed: Doc[]) {
  const store = new Map<string, Doc>(seed.map((d) => [d._id, { _rev: 'r0', ...structuredClone(d) }]))
  let rev = 0
  const audits: CatalogueAuditEntry[] = []
  const commits: Array<{ transactionId?: string; ops: Array<{ id: string; v: Record<string, unknown> }> }> = []
  const getPath = (doc: Doc, path: string): { parent: Record<string, unknown>; key: string } | null => {
    // Resolves `moduleInstallations[_key=="inst1"].config.x` (the only paths this writer uses on the project).
    const m = /^moduleInstallations\[_key=="([^"]+)"\]\.config(?:\.(.+))?$/.exec(path)
    if (!m) return null
    const inst = (doc.moduleInstallations as Array<Record<string, unknown>>).find((i) => i._key === m[1])!
    if (!m[2]) return { parent: inst, key: 'config' }
    return { parent: inst.config as Record<string, unknown>, key: m[2] }
  }
  const fetch = vi.fn(async (q: string, params: Record<string, unknown> = {}) => {
    await Promise.resolve()
    const docs = [...store.values()].filter((d) => d.projectSlug === params.projectSlug)
    if (q.startsWith('count(*[_type == "project"')) return 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'en', supportedLocales: ['en', 'it'] }
    if (q.includes('_type == "project"')) {
      const p = docs.find((d) => d._type === 'project')!
      return { _id: p._id, _rev: p._rev, inst: (p.moduleInstallations as Array<Record<string, unknown>>).find((i) => i.moduleId === 'catalogue') }
    }
    if (q.includes('_type == "catalogueTaxonomy"')) return store.get(params.id as string) ?? null
    if (q.includes('_type == "taxonomyTerm"')) return []
    if (q.includes('_type == "page"')) return [{ _id: 'p1', slug: { en: { current: 'about' } } }]
    if (q.includes('_type == "catalogueOptionList"')) return []
    if (q.includes('_type == "catalogueItem"')) {
      const items = docs.filter((d) => d._type === 'catalogueItem')
      if (q.includes('count(dietary')) return items.filter((d) => ((d.dietary as string[]) ?? []).some((x) => (params.values as string[]).includes(x))).map((d) => d._id)
      if (q.includes('"prices":')) return items.map((d) => ({ _id: d._id, prices: ((d.formats as Array<{ prices: Array<{ amount: number }> }>) ?? []).flatMap((f) => f.prices.map((p) => p.amount)) }))
      return items.filter((d) => !(q.includes('!defined(archivedAt)') && d.archivedAt))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const transaction = vi.fn(() => {
    const ops: Array<{ id: string; v: { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] } }> = []
    const tx = {
      patch: (id: string, v: { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] }) => (ops.push({ id, v }), tx),
      createIfNotExists: () => tx,
      commit: vi.fn(async (o: { transactionId?: string } = {}) => {
        for (const op of ops) if (op.v.ifRevisionID && store.get(op.id)?._rev !== op.v.ifRevisionID) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
        for (const op of ops) {
          const doc = structuredClone(store.get(op.id)!)
          for (const [k, v] of Object.entries(op.v.set ?? {})) {
            const at = getPath(doc, k)
            if (at) at.parent[at.key] = structuredClone(v)
            else doc[k] = structuredClone(v)
          }
          for (const k of op.v.unset ?? []) {
            const at = getPath(doc, k)
            if (at) delete at.parent[at.key]
            else delete doc[k]
          }
          store.set(op.id, { ...doc, _rev: `r${++rev}` })
        }
        commits.push({ transactionId: o.transactionId, ops: structuredClone(ops) as never })
        return {}
      }),
    }
    return tx
  })
  const client = { fetch, transaction }
  const deps: CatalogueSettingsDeps = {
    client: client as never,
    now: () => new Date('2026-11-03T09:00:00Z'),
    uuid: () => '00000000-0000-4000-8000-000000000002',
    audit: async (e) => void audits.push(e),
    taxonomy: { client: client as never, sources: [], sleep: async () => {}, audit: async (e) => void audits.push(e), uuid: () => '00000000-0000-4000-8000-000000000003' },
  }
  const config = () => ((store.get('project-doc')!.moduleInstallations as Array<Record<string, unknown>>)[0].config ?? null) as Record<string, unknown> | null
  return { store, deps, client, audits, commits, config, calls: () => fetch.mock.calls.length + transaction.mock.calls.length }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof CatalogueSettingsError) return e.code
    if (e instanceof CatalogueForbidden) return `forbidden:${e.capability}`
    throw e
  }
}

const channelInput = (c: typeof DINE, o: Record<string, unknown> = {}) => ({ key: c.value, label: { en: c.label.en }, active: c.active, defaultAvailability: c.defaultAvailability, ...o })

let f: ReturnType<typeof fake>
beforeEach(() => {
  f = fake([projectDoc(), item('i1', { formats: [fmt([{ _key: 'p1', _type: 'cataloguePrice', amount: 8 }, { _key: 'p2', _type: 'cataloguePrice', amount: 9, channel: 'delivery' }])] })])
})

describe('permissions (C8 P-04, P-17)', () => {
  it.each([
    ['channels', () => saveCatalogueChannels(editor(), P, { rev: 'r0', channels: [] }, f.deps)],
    ['dietaryTags (P-17)', () => saveCatalogueSettings(editor(), P, { rev: 'r0', set: { dietaryTags: [] } }, f.deps)],
    ['currency', () => saveCatalogueSettings(editor(), P, { rev: 'r0', set: { currency: 'CHF' } }, f.deps)],
    ['channel removal', () => removeCatalogueChannel(editor(), P, { rev: 'r0', key: 'delivery', expected: { prices: 0, itemRules: 0, formatRules: 0, categoryRules: 0 } }, f.deps)],
    ['setup completion', () => completeCatalogueSetup(editor(), P, { rev: 'r0', source: 'manual' }, f.deps)],
  ])('an editor cannot change %s — refused naming setup.manage, zero I/O', async (_n, run) => {
    expect(await code(run())).toBe('forbidden:catalogue.setup.manage')
    expect(f.calls()).toBe(0)
  })

  it('the item editor may read whether setup was completed (item.read), never which pack', async () => {
    const v = await loadCatalogueSettings(editor(), P, f.deps)
    expect(v.setup).toEqual({ completedAt: null, source: null })
    // D-14 / C7.9: HOW setup was completed is Setup's (setup.manage) only.
    const g = fake([projectDoc({ serviceChannels: [DINE], setupCompletedAt: '2026-11-01T10:00:00Z', setupSource: 'pack' })])
    expect((await loadCatalogueSettings(editor(), P, g.deps)).setup).toEqual({ completedAt: '2026-11-01T10:00:00Z', source: null })
    expect((await loadCatalogueSettings(owner(), P, g.deps)).setup).toEqual({ completedAt: '2026-11-01T10:00:00Z', source: 'pack' })
    expect(v.can.manage).toBe(false)
    expect(JSON.stringify(v)).not.toMatch(/packId/)
  })
})

describe('channels (C2 I-C2-4)', () => {
  it('activation with impact needs confirmation; then one guarded patch and a content-free audit row', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const next = [channelInput(DINE), channelInput(DELIVERY, { active: true, defaultAvailability: 'available' })]
    const first = await saveCatalogueChannels(owner(), P, { rev: v.rev, channels: next }, f.deps)
    expect(first.saved).toBe(false)
    expect(first.changes.map((c) => c.kind)).toEqual(['channel.activated', 'channel.default_changed'])
    expect(first.changes[0].impact).toMatchObject({ items: 1, formats: 1, toAvailable: 1 })
    expect(f.commits).toHaveLength(0)
    const r = await saveCatalogueChannels(owner(), P, { rev: v.rev, channels: next, confirmImpact: true }, f.deps)
    expect(r.saved).toBe(true)
    const stored = f.config()!.serviceChannels as Array<Record<string, unknown>>
    expect(stored[1]).toMatchObject({ _key: 'c2', value: 'delivery', active: true, defaultAvailability: 'available' })
    expect(f.commits[0].transactionId).toMatch(/^abluo-setup-channels-/)
    expect(f.audits.map((a) => a.kind)).toEqual(['channel.activated', 'channel.default_changed'])
    for (const a of f.audits) expect(validateAuditDetail(a.kind, a.detail)).toBe(true)
    expect(f.audits[0]).toMatchObject({ scope: 'channel', targetId: 'delivery', transactionId: f.commits[0].transactionId })
  })

  it('A-05: activating with an unavailable default changes nothing (all-zero impact, no confirmation)', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const r = await saveCatalogueChannels(owner(), P, { rev: v.rev, channels: [channelInput(DINE), channelInput(DELIVERY, { active: true })] }, f.deps)
    expect(r.saved).toBe(true)
    expect(r.changes).toEqual([{ kind: 'channel.activated', channelKey: 'delivery', impact: { items: 0, formats: 0, toAvailable: 0, toUnavailable: 0, shieldedByOverride: 0 } }])
  })

  it('a label/order change is no event; a removal is refused (counted cleanup only); a renamed key is refused', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const r = await saveCatalogueChannels(owner(), P, { rev: v.rev, channels: [channelInput(DELIVERY), channelInput(DINE, { label: { en: 'At the table', it: 'Al tavolo' } })] }, f.deps)
    expect(r.changes).toEqual([])
    expect(f.audits).toEqual([])
    expect(await code(saveCatalogueChannels(owner(), P, { rev: r.rev, channels: [channelInput(DINE)] }, f.deps))).toBe('channel_remove_needs_cleanup')
    expect(await code(saveCatalogueChannels(owner(), P, { rev: r.rev, channels: [channelInput(DINE), { ...channelInput(DELIVERY), label: {} }] }, f.deps))).toBe('channel_invalid')
  })

  it('a schedule is validated by the C5a validator (overlap refused)', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const overlap = [{ from: '18:00', to: '22:00', state: 'available' }, { from: '21:00', to: '23:00', state: 'available' }]
    expect(await code(saveCatalogueChannels(owner(), P, { rev: v.rev, channels: [channelInput(DINE), channelInput(DELIVERY, { defaultSchedule: overlap })] }, f.deps))).toBe('channel_invalid')
  })

  it('legacy channels without explicit defaults are not rewritten before data step D2', async () => {
    const g = fake([projectDoc({ serviceChannels: [{ _key: 'k1', value: 'dine-in', label: { en: 'Dine-in' } }] })])
    const v = await loadCatalogueSettings(owner(), P, g.deps)
    expect(await code(saveCatalogueChannels(owner(), P, { rev: v.rev, channels: [{ key: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available' }] }, g.deps))).toBe('channel_migration_pending')
  })

  it('a stale revision is a conflict, never an overwrite', async () => {
    expect(await code(saveCatalogueChannels(owner(), P, { rev: 'old', channels: [channelInput(DINE), channelInput(DELIVERY, { active: true })] }, f.deps))).toBe('conflict')
  })

  it('channelEvents: a new active channel is an activation; a new inactive one is no event', () => {
    const prev = readChannels([DINE]).channels.all
    const next = channelsFromInput([channelInput(DINE), { key: 'takeaway', label: { en: 'Takeaway' }, active: false, defaultAvailability: 'available' }], prev, { defaultLocale: 'en', locales: ['en'] }).channels
    expect(channelEvents(prev, next)).toEqual([])
  })
})

describe('channel removal (C2 I-C2-2, D-21)', () => {
  it('counted preview → confirmed cleanup of prices and rules (items, formats, categories) → entry removed → channel.removed', async () => {
    const g = fake([
      projectDoc(),
      item('i1', { formats: [fmt([{ _key: 'p1', _type: 'cataloguePrice', amount: 8 }, { _key: 'p2', _type: 'cataloguePrice', amount: 9, channel: 'delivery' }], { channelAvailability: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'available' }] })] }),
      item('drafts.i2', { channelAvailability: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable' }] }),
      { _id: `catalogue-taxonomy.${SLUG}`, _type: 'catalogueTaxonomy', projectSlug: SLUG, categories: [{ _key: 'food', _type: 'catalogueCategory', key: 'food', label: { en: 'Food' }, order: 1000, channelRules: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'available' }] }], tags: [] },
    ])
    const preview = await previewCatalogueChannelRemoval(owner(), P, { key: 'delivery' }, g.deps)
    expect(preview.usage).toEqual({ prices: 1, itemRules: 1, formatRules: 1, categoryRules: 1 })
    const v = await loadCatalogueSettings(owner(), P, g.deps)
    expect(await code(removeCatalogueChannel(owner(), P, { rev: v.rev, key: 'delivery', expected: { ...preview.usage, prices: 0 } }, g.deps))).toBe('channel_usage_changed')
    expect(g.commits).toHaveLength(0)
    const r = await removeCatalogueChannel(owner(), P, { rev: v.rev, key: 'delivery', expected: preview.usage }, g.deps)
    expect(r.cleanup).toEqual(preview.usage)
    expect(JSON.stringify(g.store.get('i1'))).not.toContain('delivery')
    expect(g.store.get('drafts.i2')!.channelAvailability).toEqual([])
    expect(JSON.stringify(g.store.get(`catalogue-taxonomy.${SLUG}`))).not.toContain('delivery')
    expect((g.config()!.serviceChannels as Array<{ value: string }>).map((c) => c.value)).toEqual(['dine-in'])
    const removed = g.audits.find((a) => a.kind === 'channel.removed')!
    expect(removed.detail).toEqual({ channelKey: 'delivery', cleanup: { categoryRules: 1, itemRules: 1, formatRules: 1, prices: 1 } })
  })
})

describe('other settings', () => {
  it('currency: a change that reinterprets stored prices needs confirmation; nothing is converted', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const first = await saveCatalogueSettings(owner(), P, { rev: v.rev, set: { currency: 'chf' } }, f.deps)
    expect(first).toMatchObject({ saved: false, confirmation: { currency: { prices: 2, items: 1, from: 'EUR', to: 'CHF' } } })
    await saveCatalogueSettings(owner(), P, { rev: v.rev, set: { currency: 'CHF' }, confirmCurrency: true }, f.deps)
    expect(f.config()!.currency).toBe('CHF')
    expect(JSON.stringify(f.store.get('i1'))).toContain('"amount":8')
    expect(await code(saveCatalogueSettings(owner(), P, { rev: 'x', set: { currency: 'XYZ' } }, f.deps))).toBe('currency_invalid')
  })

  it('public segment: existing validation (reserved / page clash) and the append-only history', async () => {
    let v = await loadCatalogueSettings(owner(), P, f.deps)
    expect(await code(saveCatalogueSettings(owner(), P, { rev: v.rev, set: { publicSegment: 'about' } }, f.deps))).toBe('segment_invalid')
    await saveCatalogueSettings(owner(), P, { rev: v.rev, set: { publicSegment: 'carta' } }, f.deps)
    expect(f.config()).toMatchObject({ publicSegment: 'carta', publicSegmentHistory: ['menu'] })
    v = await loadCatalogueSettings(owner(), P, f.deps)
    const back = await saveCatalogueSettings(owner(), P, { rev: v.rev, set: { publicSegment: 'menu' } }, f.deps)
    expect(back.notices).toEqual({ segmentRevert: 'menu' })
    expect(f.config()).toMatchObject({ publicSegment: 'menu', publicSegmentHistory: ['carta'] })
  })

  it('public name per language (empty removes), profile, prices default, format templates — one key-level patch', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    await saveCatalogueSettings(
      owner(),
      P,
      { rev: v.rev, set: { publicName: { en: 'Menu', it: 'Menù' }, defaultItemProfile: 'foodOrDrink', showPricesByDefault: false, formatTemplates: [{ key: 'glass', label: { en: 'Glass' }, quantity: { value: 25, unit: 'cl' } }] } },
      f.deps,
    )
    expect(f.commits).toHaveLength(1)
    expect(Object.keys(f.commits[0].ops[0].v.set as object).every((k) => k.startsWith('moduleInstallations[_key=="inst1"].config.'))).toBe(true)
    expect(f.config()).toMatchObject({ publicName: { _type: 'localizedString', en: 'Menu', it: 'Menù' }, defaultItemProfile: 'foodOrDrink', showPricesByDefault: false, formatTemplates: [{ _key: 'glass', key: 'glass', quantity: { value: 25, unit: 'cl' } }] })
    const v2 = await loadCatalogueSettings(owner(), P, f.deps)
    await saveCatalogueSettings(owner(), P, { rev: v2.rev, set: { publicName: { en: '', it: null } } }, f.deps)
    expect(f.config()!.publicName).toBeUndefined()
  })

  it('dietary tags: a value still used by an item (drafts count) cannot be removed', async () => {
    const g = fake([projectDoc({ serviceChannels: [DINE], dietaryTags: [{ _key: 'd1', value: 'vegan', label: { en: 'Vegan' } }] }), item('drafts.i9', { dietary: ['vegan'] })])
    const v = await loadCatalogueSettings(owner(), P, g.deps)
    expect(await code(saveCatalogueSettings(owner(), P, { rev: v.rev, set: { dietaryTags: [] } }, g.deps))).toBe('dietary_in_use')
    await saveCatalogueSettings(owner(), P, { rev: v.rev, set: { dietaryTags: [{ value: 'vegan', label: { en: 'Vegan', it: 'Vegano' } }, { value: 'gluten_free', label: { en: 'Gluten free' } }] } }, g.deps)
    expect((g.config()!.dietaryTags as Array<{ _key: string; value: string }>).map((e) => [e._key, e.value])).toEqual([['d1', 'vegan'], ['dt-gluten_free', 'gluten_free']])
  })

  it('setup completion is recorded once (D-14), separately from pack history', async () => {
    const v = await loadCatalogueSettings(owner(), P, f.deps)
    const r = await completeCatalogueSetup(owner(), P, { rev: v.rev, source: 'empty' }, f.deps)
    expect(f.config()).toMatchObject({ setupCompletedAt: '2026-11-03T09:00:00.000Z', setupSource: 'empty' })
    const again = await completeCatalogueSetup(owner(), P, { rev: r.rev, source: 'manual' }, f.deps)
    expect(again.source).toBe('empty')
  })

  it('a project without a config object gets one in the same set', () => {
    expect(configKeysPatch({ _key: 'k' }, false, { currency: 'EUR' }, [])).toEqual({ set: { 'moduleInstallations[_key=="k"].config': { _type: 'catalogueModuleConfig', currency: 'EUR' } }, unset: [] })
  })

  it('without the Catalogue installed: catalogue_not_installed', async () => {
    const g = fake([{ ...projectDoc(), moduleInstallations: [{ _key: 'inst1', moduleId: 'catalogue', enabled: false }] }])
    expect(await code(loadCatalogueSettings(owner(), P, g.deps))).toBe('catalogue_not_installed')
  })
})
