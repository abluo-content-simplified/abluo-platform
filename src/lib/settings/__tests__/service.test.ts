/**
 * Settings service: permission before I/O, a fixed allow-list, published AND
 * draft patched in one transaction, revision guards that turn a concurrent
 * write into `conflict`, key-level disclosure patches. Sanity is an in-memory fake.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { SettingsError, loadSettings, saveSettings, type SettingsDeps } from '../service'

const SLUG = 'trattoria'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['site.details.read', 'site.details.write'],
  enabledModuleIds: ['catalogue'],
  ...o,
})
const ctxOf = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const owner = () => ctxOf(grant())
const editor = () => ctxOf(grant({ role: 'editor', permissions: ['site.details.read'] }))
const noModule = () => ctxOf(grant({ enabledModuleIds: [] }))

type Doc = Record<string, unknown> & { _id: string; _rev: string }

function fake(opts: { draft?: boolean; catalogue?: boolean | 'noconfig' } = {}) {
  const docs = new Map<string, Doc>()
  docs.set('site1', { _id: 'site1', _rev: 's1', _type: 'siteConfig', projectSlug: SLUG, defaultLocale: 'it', supportedLocales: ['it', 'en', 'de'], amazonTrackingIds: [{ marketplace: 'amazon.it', trackingId: 'old-21' }] })
  if (opts.draft) docs.set('drafts.site1', { _id: 'drafts.site1', _rev: 'd1', _type: 'siteConfig', projectSlug: SLUG, defaultLocale: 'it', supportedLocales: ['it', 'en', 'de'] })
  docs.set('proj1', {
    _id: 'proj1',
    _rev: 'p1',
    _type: 'project',
    projectSlug: SLUG,
    moduleInstallations:
      opts.catalogue === false
        ? []
        : [{ _key: 'k1', moduleId: 'catalogue', enabled: true, ...(opts.catalogue === 'noconfig' ? {} : { config: { showPricesByDefault: true, affiliateDisclosure: { _type: 'localizedString', it: 'Vecchio' } } }) }],
  })
  let n = 0
  const committed: Array<{ id: string; ops: Record<string, unknown> }> = []
  const fetch = vi.fn(async (q: string) => {
    if (q.startsWith('count(')) return 1
    if (q.includes('_type == "siteConfig"')) return [...docs.values()].filter((d) => d._type === 'siteConfig')
    if (q.includes('_type == "project"')) {
      const p = docs.get('proj1')!
      const inst = (p.moduleInstallations as Array<Record<string, any>>).find((i) => i.moduleId === 'catalogue')
      return { _id: p._id, _rev: p._rev, catalogue: inst ? { _key: inst._key, enabled: inst.enabled, hasConfig: !!inst.config, disclosure: inst.config?.affiliateDisclosure ?? null } : null }
    }
    throw new Error(`unexpected ${q}`)
  })
  const transaction = vi.fn(() => {
    const pending: Array<{ id: string; ops: Record<string, any> }> = []
    const tx = {
      patch: (id: string, ops: Record<string, unknown>) => (pending.push({ id, ops }), tx),
      commit: vi.fn(async () => {
        for (const p of pending) {
          const d = docs.get(p.id)
          if (!d || d._rev !== p.ops.ifRevisionID) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
        }
        for (const p of pending) {
          const d = docs.get(p.id)!
          Object.assign(d, p.ops.set ?? {})
          for (const u of p.ops.unset ?? []) delete d[u]
          d._rev = `n${++n}`
          committed.push({ id: p.id, ops: p.ops })
        }
        return {}
      }),
    }
    return tx
  })
  return { docs, fetch, transaction, committed, deps: { client: { fetch, transaction } } as unknown as SettingsDeps }
}

const rev = 's1|p1'
const amazon = [{ marketplace: 'amazon.de', trackingId: 'tmz-21' }]

describe('loadSettings', () => {
  it('needs site.details.read; editors can read and see canWrite false', async () => {
    const f = fake()
    const v = await loadSettings(editor(), 'project-a', f.deps)
    expect(v).toMatchObject({ rev, canWrite: false, locales: ['it', 'en', 'de'], catalogueInstalled: true, disclosure: { it: 'Vecchio' } })
    expect(v.amazon).toEqual([{ _key: 'amz-amazon-it', marketplace: 'amazon.it', trackingId: 'old-21' }])
    await expect(loadSettings(ctxOf(grant({ permissions: [] })), 'project-a', f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })
  it('hides the disclosure when the Catalogue is not installed', async () => {
    expect(await loadSettings(noModule(), 'project-a', fake().deps)).toMatchObject({ catalogueInstalled: false, disclosure: {} })
  })
})

describe('saveSettings', () => {
  it('an editor cannot write, and nothing is read or written', async () => {
    const f = fake()
    await expect(saveSettings(editor(), 'project-a', { rev, set: { amazonTrackingIds: amazon } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.transaction).not.toHaveBeenCalled()
  })
  it('a project the caller has no grant on is refused', async () => {
    await expect(saveSettings(owner(), 'project-b', { rev, set: { amazonTrackingIds: amazon } }, fake().deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
  })
  it('refuses any path outside the allow-list before touching Sanity', async () => {
    const f = fake()
    await expect(saveSettings(owner(), 'project-a', { rev, set: { supportedLocales: ['fr'] } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(f.transaction).not.toHaveBeenCalled()
  })
  it('patches the published siteConfig only when there is no draft, and returns the new revision', async () => {
    const f = fake()
    const r = await saveSettings(owner(), 'project-a', { rev, set: { amazonTrackingIds: amazon } }, f.deps)
    expect(f.committed.map((c) => c.id)).toEqual(['site1'])
    expect(f.docs.get('site1')!.amazonTrackingIds).toEqual([{ _type: 'amazonTrackingId', _key: 'amz-amazon-de', marketplace: 'amazon.de', trackingId: 'tmz-21' }])
    expect(r.rev).toBe('n1|p1')
  })
  it('patches the Studio draft too, in the same transaction, so Publish cannot undo it', async () => {
    const f = fake({ draft: true })
    await saveSettings(owner(), 'project-a', { rev, set: { amazonTrackingIds: amazon } }, f.deps)
    expect(f.transaction).toHaveBeenCalledTimes(1)
    expect(f.committed.map((c) => c.id).sort()).toEqual(['drafts.site1', 'site1'])
    expect(f.docs.get('drafts.site1')!.amazonTrackingIds).toEqual(f.docs.get('site1')!.amazonTrackingIds)
  })
  it('an empty list removes the field from both', async () => {
    const f = fake({ draft: true })
    await saveSettings(owner(), 'project-a', { rev, set: { amazonTrackingIds: [] } }, f.deps)
    expect(f.docs.get('site1')!.amazonTrackingIds).toBeUndefined()
  })
  it('a stale revision is a conflict and writes nothing', async () => {
    const f = fake({ draft: true })
    f.docs.get('site1')!._rev = 's2' // someone saved meanwhile
    await expect(saveSettings(owner(), 'project-a', { rev, set: { amazonTrackingIds: amazon } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.committed).toEqual([])
  })
  it('disclosure: key-level patch of one language on the project document, other keys untouched', async () => {
    const f = fake()
    const r = await saveSettings(owner(), 'project-a', { rev, set: { 'affiliateDisclosure.de': 'Hallo' } }, f.deps)
    expect(f.committed).toEqual([{ id: 'proj1', ops: { ifRevisionID: 'p1', set: { 'moduleInstallations[_key=="k1"].config.affiliateDisclosure.de': 'Hallo' } } }])
    expect(r.rev).toBe('s1|n1')
  })
  it('disclosure: a stale project revision is a conflict', async () => {
    const f = fake()
    f.docs.get('proj1')!._rev = 'p2'
    await expect(saveSettings(owner(), 'project-a', { rev, set: { 'affiliateDisclosure.de': 'Hallo' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
  })
  it('disclosure: refused when the Catalogue is not installed (by grant or by project)', async () => {
    await expect(saveSettings(noModule(), 'project-a', { rev, set: { 'affiliateDisclosure.it': 'x' } }, fake().deps)).rejects.toMatchObject({ code: 'catalogue_not_installed' })
    await expect(saveSettings(owner(), 'project-a', { rev, set: { 'affiliateDisclosure.it': 'x' } }, fake({ catalogue: false }).deps)).rejects.toMatchObject({ code: 'catalogue_not_installed' })
  })
  it('disclosure: only the site languages', async () => {
    await expect(saveSettings(owner(), 'project-a', { rev, set: { 'affiliateDisclosure.fr': 'x' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_field' })
  })
  it('both in one batch: one transaction, three documents guarded', async () => {
    const f = fake({ draft: true })
    await saveSettings(owner(), 'project-a', { rev, set: { amazonTrackingIds: amazon, 'affiliateDisclosure.it': '' } }, f.deps)
    expect(f.transaction).toHaveBeenCalledTimes(1)
    expect(f.committed).toHaveLength(3)
    expect(SettingsError).toBeDefined()
  })
})

describe('Awin settings', () => {
  it('loadSettings reads the publisher ID and shops (junk dropped)', async () => {
    const f = fake()
    Object.assign(f.docs.get('site1')!, { awinPublisherId: '123456', affiliateShops: [{ shop: 'ibs' }, { shop: 'nope' }, { shop: 'ibs' }, { shop: 'amazon' }] })
    expect((await loadSettings(owner(), 'project-a', f.deps)).awin).toEqual({ publisherId: '123456', shops: ['ibs', 'amazon'] })
    expect((await loadSettings(owner(), 'project-a', fake().deps)).awin).toEqual({ publisherId: '', shops: [] })
  })
  it('saves ID and shops on the published doc and the draft in one transaction', async () => {
    const f = fake({ draft: true })
    await saveSettings(owner(), 'project-a', { rev, set: { awinPublisherId: '123456', affiliateShops: ['lafeltrinelli', 'ibs'] } }, f.deps)
    expect(f.transaction).toHaveBeenCalledTimes(1)
    expect(f.committed.map((c) => c.id).sort()).toEqual(['drafts.site1', 'site1'])
    const expected = [
      { _key: 'shop-lafeltrinelli', _type: 'affiliateShopSetting', shop: 'lafeltrinelli' },
      { _key: 'shop-ibs', _type: 'affiliateShopSetting', shop: 'ibs' },
    ]
    for (const id of ['site1', 'drafts.site1']) expect(f.docs.get(id)).toMatchObject({ awinPublisherId: '123456', affiliateShops: expected })
    expect(f.docs.get('site1')!.amazonTrackingIds).toBeDefined()
  })
  it('empty values unset the fields (published and draft)', async () => {
    const f = fake({ draft: true })
    Object.assign(f.docs.get('site1')!, { awinPublisherId: '123456', affiliateShops: [{ shop: 'ibs' }] })
    Object.assign(f.docs.get('drafts.site1')!, { awinPublisherId: '123456', affiliateShops: [{ shop: 'ibs' }] })
    await saveSettings(owner(), 'project-a', { rev, set: { awinPublisherId: '', affiliateShops: [] } }, f.deps)
    for (const id of ['site1', 'drafts.site1']) expect(f.docs.get(id)).not.toHaveProperty('awinPublisherId')
    for (const id of ['site1', 'drafts.site1']) expect(f.docs.get(id)).not.toHaveProperty('affiliateShops')
  })
  it('refuses an invalid ID or shop before touching Sanity; a stale revision conflicts; editors cannot write', async () => {
    const f = fake()
    await expect(saveSettings(owner(), 'project-a', { rev, set: { awinPublisherId: 'abc' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(saveSettings(owner(), 'project-a', { rev, set: { affiliateShops: ['zzz'] } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.transaction).not.toHaveBeenCalled()
    await expect(saveSettings(owner(), 'project-a', { rev: 'old|p1', set: { awinPublisherId: '123456' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(saveSettings(editor(), 'project-a', { rev, set: { awinPublisherId: '123456' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
  })
})
