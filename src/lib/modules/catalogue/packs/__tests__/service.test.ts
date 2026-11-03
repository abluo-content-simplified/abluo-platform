/**
 * The pack service (C7.5): one transaction with a deterministic id, revision guards on the
 * taxonomy / project / history documents, history only after success, retry never duplicates,
 * exact preview (fingerprint), chunked large packs with a resumable run marker. Sanity is the
 * in-memory fake of fake-sanity.ts.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { validateAuditDetail } from '../../audit/events'
import { readPackHistory } from '../history'
import { defaultSelection, type PackSelection } from '../plan'
import { getPack } from '../registry'
import { applyPack, loadStarterStructures, previewPack, type PackServiceDeps } from '../service'
import * as registry from '../registry'
import type { PackDeclaration } from '../types'
import { ctxOf, EDITOR, fakeSanity, grant, P, projectDoc, siteDoc, SLUG, type Doc } from './fake-sanity'

const owner = () => ctxOf()
const editor = () => ctxOf(grant(EDITOR, { role: 'editor' }))

async function apply(deps: PackServiceDeps, packId: string, selection?: PackSelection, o: { update?: boolean } = {}) {
  const pack = getPack(packId)!
  const sel = selection ?? defaultSelection(pack)
  const preview = await previewPack(owner(), P, { packId, selection: sel, update: o.update }, deps)
  return { preview, result: await applyPack(owner(), P, { packId, version: pack.version, selection: sel, planFingerprint: preview.plan.fingerprint, update: o.update }, deps) }
}

const seed = (config?: Record<string, unknown>, extra?: Record<string, unknown>): Doc[] => [projectDoc(config, extra), siteDoc()]

describe('applyPack', () => {
  it('apply/single-tx: exactly one commit with the taxonomy write, the drafts, the config and the history; deterministic transaction id', async () => {
    const f = fakeSanity(seed())
    const { result } = await apply(f.deps, 'pizzeria')
    expect(result.ok).toBe(true)
    expect(f.commits).toHaveLength(1)
    const ops = f.commits[0].ops
    expect(ops.map((o) => (o.k === 'patch' || o.k === 'delete' ? `${o.k}:${o.id}` : `${o.k}:${o.doc._id}`))).toEqual([
      `create:catalogue-taxonomy.${SLUG}`,
      `createIfNotExists:drafts.catalogue-collection.${SLUG}.menu`,
      `createIfNotExists:drafts.catalogue-option-list.${SLUG}.extra-toppings`,
      `createIfNotExists:drafts.catalogue-option-list.${SLUG}.remove-ingredients`,
      'patch:project-doc',
      `create:catalogue-packs.${SLUG}`,
    ])
    expect(f.commits[0].transactionId).toMatch(/^abluo-pack-[0-9a-f]{40}$/)
    // same inputs → same id
    const g = fakeSanity(seed())
    await apply(g.deps, 'pizzeria')
    expect(g.commits[0].transactionId).toBe(f.commits[0].transactionId)
    // the project patch is guarded and key-level
    const projectPatch = ops.find((o) => o.k === 'patch' && o.id === 'project-doc') as { v: { ifRevisionID: string; set: Record<string, unknown> } }
    expect(projectPatch.v.ifRevisionID).toBe('r0')
    expect(Object.keys(projectPatch.v.set).every((k) => k.startsWith('moduleInstallations[_key=="inst1"].config.'))).toBe(true)
  })

  it('writes what the preview showed: channels explicit, setup complete (pack), currency untouched, drafts only', async () => {
    const f = fakeSanity(seed({ currency: 'CHF' }))
    await apply(f.deps, 'pizzeria')
    const cfg = f.config()
    expect(cfg.currency).toBe('CHF')
    expect((cfg.serviceChannels as { value: string; active: boolean; defaultAvailability: string }[]).map((c) => [c.value, c.active, c.defaultAvailability])).toEqual([
      ['dine-in', true, 'available'],
      ['takeaway', true, 'available'],
      ['delivery', true, 'unavailable'],
    ])
    expect(cfg).toMatchObject({ setupCompletedAt: '2026-11-03T09:00:00.000Z', setupSource: 'pack', publicSegment: 'menu', publicSegmentHistory: [], defaultItemProfile: 'foodOrDrink', publicName: { _type: 'localizedString', en: 'Menu', it: 'Menu' } })
    // apply/drafts-only
    expect([...f.store.keys()].filter((k) => k.includes('catalogue-collection') || k.includes('catalogue-option-list')).every((k) => k.startsWith('drafts.'))).toBe(true)
    const menu = f.store.get(`drafts.catalogue-collection.${SLUG}.menu`)!
    expect(menu.publishedAt).toBeUndefined()
    // apply/builder: the fields the dashboard create path writes
    expect(menu).toMatchObject({ _type: 'catalogueCollection', projectSlug: SLUG, collectionType: 'menu', hasPage: false, visibility: 'public', name: { _type: 'localizedString', en: 'Menu', it: 'Menu' } })
    expect(menu.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect((menu.sections as { _key: string; _type: string }[]).map((s) => s._key)).toEqual(['pizza', 'starters', 'salads', 'desserts', 'beverages'])
    const list = f.store.get(`drafts.catalogue-option-list.${SLUG}.extra-toppings`)!
    expect((list.options as { priceDelta: number; allergenDeclaration?: unknown }[]).every((o) => o.priceDelta === 0 && o.allergenDeclaration)).toBe(true)
    // category defaults point at the deterministic option lists
    const tax = f.store.get(`catalogue-taxonomy.${SLUG}`)!
    expect((tax.categories as { key: string; defaultOptionListIds?: string[] }[]).find((c) => c.key === 'pizza')!.defaultOptionListIds).toEqual([`catalogue-option-list.${SLUG}.extra-toppings`, `catalogue-option-list.${SLUG}.remove-ingredients`])
    // history
    const hist = readPackHistory({ applied: f.store.get(`catalogue-packs.${SLUG}`)!.applied })
    expect(hist.map((h) => h._key)).toEqual(['pizzeria@3'])
    expect(hist[0].added.channels).toEqual(['dine-in', 'takeaway', 'delivery'])
    // audit pack.applied, content-free
    expect(f.audits.map((a) => a.kind)).toEqual(['pack.applied'])
    expect(validateAuditDetail(f.audits[0].kind, f.audits[0].detail)).toBe(true)
  })

  it('apply/permission: without the setup capability nothing is read', async () => {
    const f = fakeSanity(seed())
    const r = await applyPack(editor(), P, { packId: 'pizzeria', version: 3, selection: defaultSelection(getPack('pizzeria')!), planFingerprint: 'x' }, f.deps)
    expect(r).toEqual({ ok: false, code: 'pack_forbidden' })
    expect(f.calls()).toBe(0)
    await expect(previewPack(editor(), P, { packId: 'pizzeria' }, f.deps)).rejects.toMatchObject({ capability: 'catalogue.setup.manage' })
    expect(f.calls()).toBe(0)
  })

  it('apply/plan-changed: state changed between preview and apply → new plan, zero writes', async () => {
    const f = fakeSanity(seed())
    const pack = getPack('bookshop')!
    const preview = await previewPack(owner(), P, { packId: 'bookshop' }, f.deps)
    const project = f.store.get('project-doc')!
    ;(project.moduleInstallations as { config: Record<string, unknown> }[])[0].config.publicSegment = 'libri'
    f.bump('project-doc')
    const r = await applyPack(owner(), P, { packId: 'bookshop', version: pack.version, selection: defaultSelection(pack), planFingerprint: preview.plan.fingerprint }, f.deps)
    expect(r).toMatchObject({ ok: false, code: 'pack_plan_changed' })
    expect(f.commits).toHaveLength(0)
  })

  it('apply/project-rev-guard: the project revision is part of the fingerprint (a moved _rev alone is a changed plan)', async () => {
    const f = fakeSanity(seed())
    const pack = getPack('bookshop')!
    const preview = await previewPack(owner(), P, { packId: 'bookshop' }, f.deps)
    f.bump('project-doc')
    const r = await applyPack(owner(), P, { packId: 'bookshop', version: 3, selection: defaultSelection(pack), planFingerprint: preview.plan.fingerprint }, f.deps)
    expect(r).toMatchObject({ ok: false, code: 'pack_plan_changed' })
    expect(f.commits).toHaveLength(0)
  })

  it('apply/revision-conflict: the taxonomy document moves during the commit → pack_conflict, zero writes', async () => {
    const f = fakeSanity([...seed(), { _id: `catalogue-taxonomy.${SLUG}`, _type: 'catalogueTaxonomy', projectSlug: SLUG, categories: [], tags: [] }])
    const pack = getPack('bookshop')!
    const preview = await previewPack(owner(), P, { packId: 'bookshop' }, f.deps)
    f.failOn((n) => {
      if (n === 1) f.bump(`catalogue-taxonomy.${SLUG}`)
      return null
    })
    const r = await applyPack(owner(), P, { packId: 'bookshop', version: 3, selection: defaultSelection(pack), planFingerprint: preview.plan.fingerprint }, f.deps)
    expect(r).toMatchObject({ ok: false, code: 'pack_conflict' })
    expect(f.commits).toHaveLength(0)
    expect(f.store.get(`catalogue-packs.${SLUG}`)).toBeUndefined()
  })

  it('apply/failure-no-record: a failed commit leaves no history; the second call succeeds without duplicates', async () => {
    const f = fakeSanity(seed())
    f.failOn((n) => (n === 1 ? Object.assign(new Error('boom'), { statusCode: 500 }) : null))
    const first = await apply(f.deps, 'pizzeria')
    expect(first.result).toMatchObject({ ok: false, code: 'pack_failed' })
    expect(f.store.get(`catalogue-packs.${SLUG}`)).toBeUndefined()
    expect([...f.store.keys()].some((k) => k.includes('catalogue-collection'))).toBe(false)
    f.failOn(null)
    const second = await apply(f.deps, 'pizzeria')
    expect(second.result.ok).toBe(true)
    expect([...f.store.keys()].filter((k) => k.includes('catalogue-collection'))).toEqual([`drafts.catalogue-collection.${SLUG}.menu`])
    expect((f.store.get(`catalogue-packs.${SLUG}`)!.applied as unknown[]).length).toBe(1)
  })

  it('apply/lost-response: the commit succeeded but the response was lost → verified by re-reading, ok once, one history entry', async () => {
    const f = fakeSanity(seed())
    f.failOn((n) => (n === 1 ? 'lost' : null))
    const { result } = await apply(f.deps, 'pizzeria')
    expect(result.ok).toBe(true)
    expect((f.store.get(`catalogue-packs.${SLUG}`)!.applied as unknown[]).length).toBe(1)
    expect(f.audits.filter((a) => a.kind === 'pack.applied')).toHaveLength(1)
    // a later retry is refused, nothing duplicated
    f.failOn(null)
    const again = await apply(f.deps, 'pizzeria')
    expect(again.result).toMatchObject({ ok: false, code: 'pack_already_applied' })
    expect(f.commits).toHaveLength(1)
  })

  it('segment clash → pack_blocked, zero writes', async () => {
    const f = fakeSanity([...seed(), { _id: 'page-1', _type: 'page', projectSlug: SLUG, slug: { en: { current: 'menu/lunch' } } }])
    const { result } = await apply(f.deps, 'pizzeria')
    expect(result).toMatchObject({ ok: false, code: 'pack_blocked' })
    expect(f.commits).toHaveLength(0)
  })

  it('apply/never-overwrites: renamed and reordered tenant nodes stay byte-identical; new nodes append', async () => {
    const own = [
      { _key: 'salads', _type: 'catalogueCategory', key: 'salads', label: { _type: 'localizedString', en: 'Our greens' }, order: 9000 },
      { _key: 'pizza', _type: 'catalogueCategory', key: 'pizza', label: { _type: 'localizedString', en: 'Le pizze' }, order: 1000 },
    ]
    const f = fakeSanity([...seed(), { _id: `catalogue-taxonomy.${SLUG}`, _type: 'catalogueTaxonomy', projectSlug: SLUG, categories: own, tags: [] }])
    await apply(f.deps, 'pizzeria')
    const rows = f.store.get(`catalogue-taxonomy.${SLUG}`)!.categories as Record<string, unknown>[]
    expect(rows.slice(0, 2)).toEqual(own)
    expect(rows.find((r) => r.key === 'starters')!.order).toBe(10000)
    expect(rows.find((r) => r.key === 'pizza_classiche')).toMatchObject({ parentKey: 'pizza', order: 1000 })
  })

  it('apply/existing-published-collection: an update adds a section to a published-only collection through a new draft; published copy byte-identical', async () => {
    const id = `catalogue-collection.${SLUG}.menu`
    const published = { _id: id, _type: 'catalogueCollection', projectSlug: SLUG, publicId: 'pub-1', name: { en: 'Menu' }, collectionType: 'menu', sections: [{ _key: 'pizza', _type: 'catalogueSection', name: { en: 'Pizza' }, items: [{ _ref: 'x' }] }], publishedAt: '2026-10-01' }
    const f = fakeSanity([...seed(), published])
    const before = structuredClone(f.store.get(id))
    await apply(f.deps, 'pizzeria')
    expect(f.store.get(id)).toEqual(before)
    const draft = f.store.get(`drafts.${id}`)!
    expect((draft.sections as { _key: string }[]).map((s) => s._key)).toEqual(['pizza', 'starters', 'salads', 'desserts', 'beverages'])
    expect((draft.sections as { items?: unknown[] }[])[0].items).toEqual([{ _ref: 'x' }])
    expect(draft.publicId).toBe('pub-1')
  })

  it('empty/records-only: Empty writes one history entry and the setup marker (source empty), nothing else', async () => {
    const f = fakeSanity(seed())
    const { result } = await apply(f.deps, 'empty')
    expect(result.ok).toBe(true)
    expect(f.commits[0].ops.map((o) => o.k + ':' + (o.k === 'patch' || o.k === 'delete' ? o.id : o.doc._id))).toEqual(['patch:project-doc', `create:catalogue-packs.${SLUG}`])
    expect(f.config()).toMatchObject({ setupCompletedAt: '2026-11-03T09:00:00.000Z', setupSource: 'empty' })
    expect(Object.keys(f.config()).sort()).toEqual(['_type', 'currency', 'setupCompletedAt', 'setupSource'])
  })

  it('bookshop@3 as the optional update of a legacy bookshop@1 (tmz after D3): additive, profile kept, audited as pack.updated', async () => {
    const tmzConfig = { currency: 'EUR', publicSegment: 'books', publicSegmentHistory: ['books'], defaultItemProfile: 'product', publicName: { en: 'Books' }, setupCompletedAt: '2026-06-01T00:00:00.000Z', setupSource: 'pack', itemImageShape: 'portrait' }
    const hist = { _id: `catalogue-packs.${SLUG}`, _type: 'cataloguePackHistory', projectSlug: SLUG, applied: [{ _key: 'bookshop@1', id: 'bookshop', version: 1, appliedAt: '2026-06-01', appliedBy: 'migration', added: { settings: ['publicSegment', 'defaultItemProfile'] }, mapped: [], skipped: [] }] }
    const f = fakeSanity([...seed(tmzConfig, { appliedPreset: { id: 'bookshop', version: 1, appliedAt: '2026-06-01' } }), hist])
    const view = await loadStarterStructures(owner(), P, f.deps)
    expect(view.offers).toEqual([{ id: 'bookshop', fromVersion: 1, toVersion: 3 }])
    const { preview, result } = await apply(f.deps, 'bookshop', undefined, { update: true })
    expect(preview.plan.conflicts.filter((c) => c.blocking)).toEqual([])
    expect(result.ok).toBe(true)
    expect(f.config()).toMatchObject({ defaultItemProfile: 'product', publicSegment: 'books', itemImageShape: 'portrait', setupSource: 'pack', setupCompletedAt: '2026-06-01T00:00:00.000Z' })
    const applied = f.store.get(`catalogue-packs.${SLUG}`)!.applied as { _key: string }[]
    expect(applied.map((a) => a._key)).toEqual(['bookshop@1', 'bookshop@3'])
    expect(f.audits.map((a) => a.kind)).toEqual(['pack.updated'])
    expect(validateAuditDetail('pack.updated', f.audits[0].detail)).toBe(true)
    expect((await loadStarterStructures(owner(), P, f.deps)).offers).toEqual([])
  })

  it('preview reports the availability impact of ticked channels on existing items, and the currency read-only', async () => {
    const f = fakeSanity(seed({ currency: 'EUR' }), { items: [{ _id: 'item-1', _type: 'catalogueItem', projectSlug: SLUG, formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [] }] }] })
    const p = await previewPack(owner(), P, { packId: 'pizzeria' }, f.deps)
    expect(p.currency).toBe('EUR')
    expect(p.impact.itemsChanged).toBeGreaterThan(0)
    expect(f.commits).toHaveLength(0)
  })
})

describe('apply/chunked: a synthetic oversize pack', () => {
  const original = structuredClone(getPack('bookshop')!)
  const big = (): PackDeclaration => {
    const base = structuredClone(original)
    return {
      ...base,
      id: 'bookshop',
      optionGroups: Array.from({ length: 250 }, (_, i) => ({ key: `g${i}`, name: { en: `G${i}`, it: `G${i}`, de: `G${i}` }, min: 0, max: null, choices: [{ key: 'a', label: { en: 'A', it: 'A', de: 'A' }, priceDelta: 0 as const, kind: 'remove' as const }] })),
    }
  }

  it('taxonomy + marker first; documents; settings + history + marker delete last; a failed chunk leaves no history and resumes completely', async () => {
    const spy = vi.spyOn(registry, 'getPack').mockImplementation((id) => (id === 'bookshop' ? big() : null))
    try {
      const f = fakeSanity(seed())
      const pack = big()
      const sel = defaultSelection(pack)
      const preview = await previewPack(owner(), P, { packId: 'bookshop', selection: sel }, f.deps)
      expect(preview.plan.needsChunking).toBe(true)
      f.failOn((n) => (n === 3 ? Object.assign(new Error('boom'), { statusCode: 500 }) : null))
      const r = await applyPack(owner(), P, { packId: 'bookshop', version: 3, selection: sel, planFingerprint: preview.plan.fingerprint }, f.deps)
      expect(r).toMatchObject({ ok: false, code: 'pack_interrupted' })
      expect(f.store.get(`catalogue-packs.${SLUG}`)).toBeUndefined()
      expect(f.store.get(`catalogue-pack-run.${SLUG}.bookshop-v3`)).toMatchObject({ status: 'running' })
      expect((f.store.get(`catalogue-taxonomy.${SLUG}`)!.categories as unknown[]).length).toBe(pack.categories.length)
      expect(f.audits.map((a) => a.kind)).toEqual(['pack.interrupted'])
      expect((await loadStarterStructures(owner(), P, f.deps)).interrupted).toEqual([{ packId: 'bookshop', version: 3 }])
      // resume
      f.failOn(null)
      const again = await previewPack(owner(), P, { packId: 'bookshop', selection: sel }, f.deps)
      const done = await applyPack(owner(), P, { packId: 'bookshop', version: 3, selection: sel, planFingerprint: again.plan.fingerprint }, f.deps)
      expect(done.ok).toBe(true)
      expect(f.store.get(`catalogue-pack-run.${SLUG}.bookshop-v3`)).toBeUndefined()
      const rec = readPackHistory({ applied: f.store.get(`catalogue-packs.${SLUG}`)!.applied })[0]
      expect(rec.added.categories).toHaveLength(pack.categories.length)
      expect(rec.added.optionGroups).toHaveLength(250)
      expect([...f.store.keys()].filter((k) => k.includes('catalogue-option-list')).length).toBe(250)
    } finally {
      spy.mockRestore()
    }
  })
})
