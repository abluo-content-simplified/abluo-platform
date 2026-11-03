/**
 * CatalogueTaxonomyService (C1.7, C1.7a, C8 §8.3) — permission split (P-12, P-16, P-19, P-20,
 * P-21), first-write seeding, idempotent retry vs user conflict, deletion routes and counted
 * cleanup, rule changes with impact and C12 audit rows. Sanity is an in-memory fake that honours
 * $projectSlug, ifRevisionID and transactions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { CatalogueForbidden } from '@/lib/api/catalogue-capability-guard'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { CatalogueAuditEntry } from '../../audit/events'
import { validateAuditDetail } from '../../audit/events'
import {
  CatalogueTaxonomyError,
  archiveCategory,
  archiveTag,
  categoryUsage,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  listTaxonomy,
  moveCategory,
  previewCategoryDeletion,
  previewCategoryRule,
  pruneChannelFromCategories,
  reassignCategory,
  reorderChildren,
  reorderTags,
  setCategoryRule,
  updateCategory,
  updateTag,
  type CatalogueTaxonomyDeps,
} from '../service'

const SLUG = 'trattoria'
const DOC_ID = `catalogue-taxonomy.${SLUG}`
const ALL = [
  'catalogue.item.read', 'catalogue.item.write', 'catalogue.item.delete', 'catalogue.item.deletePublished',
  'catalogue.collection.write', 'catalogue.collection.delete', 'catalogue.collection.deletePublished',
  'catalogue.taxonomy.write', 'catalogue.setup.manage', 'catalogue.import.use', 'catalogue.export.use',
  'catalogue.allergen.update', 'catalogue.readiness.update',
]
const EDITOR = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.item.delete', 'catalogue.collection.write', 'catalogue.collection.delete', 'catalogue.taxonomy.write', 'catalogue.export.use', 'catalogue.allergen.update']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['catalogue'],
  ...o,
})
const ctxOf = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const owner = () => ctxOf(grant())
const editor = () => ctxOf(grant({ role: 'editor', permissions: EDITOR }))
const viewer = () => ctxOf(grant({ role: 'viewer', permissions: ['catalogue.item.read'] }))

type Doc = Record<string, unknown> & { _id: string }

const cat = (key: string, label: Record<string, string>, parentKey: string | null, order: number, extra: Record<string, unknown> = {}) => ({
  _key: key,
  _type: 'catalogueCategory',
  key,
  label: { _type: 'localizedString', ...label },
  ...(parentKey && { parentKey }),
  order,
  ...extra,
})
/** C1.11 T-food. */
const T_FOOD = [
  cat('food', { en: 'Food', it: 'Cibo', de: 'Essen' }, null, 1000),
  cat('pizza', { en: 'Pizza', it: 'Pizza', de: 'Pizza' }, 'food', 1000),
  cat('pizza_classiche', { en: 'Classic', it: 'Classiche' }, 'pizza', 1000),
  cat('pizza_bianche', { en: 'White', it: 'Bianche' }, 'pizza', 2000),
  cat('desserts', { en: 'Desserts', it: 'Dolci', de: 'Desserts' }, 'food', 2000),
  cat('beverages', { en: 'Beverages', it: 'Bevande', de: 'Getränke' }, null, 2000),
  cat('alcoholic', { en: 'Alcoholic', it: 'Alcolici', de: 'Alkoholisch' }, 'beverages', 1000),
  cat('liqueurs', { en: 'Liqueurs', it: 'Liquori', de: 'Liköre' }, 'alcoholic', 1000),
]
const TAGS = [{ _key: 'spicy', _type: 'catalogueTag', key: 'spicy', label: { _type: 'localizedString', en: 'Spicy' }, order: 1000 }]
const taxonomyDoc = (categories = T_FOOD, tags = TAGS): Doc => ({ _id: DOC_ID, _type: 'catalogueTaxonomy', projectSlug: SLUG, categories, tags })
const CHANNELS = [
  { _key: 'c1', value: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available' },
  { _key: 'c2', value: 'delivery', label: { en: 'Delivery' }, active: true, defaultAvailability: 'unavailable' },
]
const item = (id: string, f: Record<string, unknown>): Doc => ({ _id: id, _type: 'catalogueItem', projectSlug: SLUG, name: { en: id }, ...f })

function fake(seed: Doc[] = [], opts: { terms?: Doc[]; config?: Record<string, unknown> } = {}) {
  const store = new Map<string, Doc>(seed.map((d) => [d._id, { _rev: 'r0', ...structuredClone(d) }]))
  let rev = 0
  const nextRev = () => `r${++rev}`
  const commits: Array<{ transactionId?: string; ops: unknown[] }> = []
  const audits: CatalogueAuditEntry[] = []
  let failNextCommits = 0
  const queryHooks: Array<(q: string, p: Record<string, unknown>) => unknown | undefined> = []

  const fetch = vi.fn(async (q: string, params: Record<string, unknown> = {}) => {
    await Promise.resolve()
    for (const h of queryHooks) {
      const r = h(q, params)
      if (r !== undefined) return r
    }
    const slug = params.projectSlug
    const docs = [...store.values()].filter((d) => d.projectSlug === slug)
    if (q.startsWith('count(*[_type == "project"')) return 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'en', supportedLocales: ['en', 'it', 'de'] }
    if (q.includes('_type == "catalogueTaxonomy"')) {
      const d = store.get(params.id as string)
      return d && d.projectSlug === slug ? { _id: d._id, _rev: d._rev, categories: d.categories, tags: d.tags } : null
    }
    if (q.includes('_type == "taxonomyTerm"')) return opts.terms ?? []
    if (q.includes('_type == "project"')) return { config: { serviceChannels: CHANNELS, ...(opts.config ?? {}) } }
    if (q.includes('_type == "catalogueOptionList"')) return docs.filter((d) => d._type === 'catalogueOptionList').map((d) => d._id)
    if (q.includes('_type == "catalogueItem"')) {
      const items = docs.filter((d) => d._type === 'catalogueItem' && !d._id.startsWith('versions.'))
      if (q.includes('primaryCategory == $key')) {
        const k = params.key
        return items
          .filter((d) => d.primaryCategory === k || ((d.additionalCategories as string[]) ?? []).includes(k as string) || (d.primaryCategory === undefined && d.additionalCategories === undefined && ((d.categories as string[]) ?? []).includes(k as string)))
          .map((d) => ({ _id: d._id, name: (d.name as Record<string, string>)?.en ?? '', primaryCategory: d.primaryCategory, additionalCategories: d.additionalCategories, categories: d.categories }))
      }
      if (q.includes('!defined(archivedAt)')) return items.filter((d) => !d.archivedAt)
      return items.map((d) => ({ ...d, name: (d.name as Record<string, string>)?.en ?? '' }))
    }
    throw new Error(`unexpected query ${q}`)
  })

  const transaction = vi.fn(() => {
    const ops: Array<{ kind: 'patch'; id: string; v: { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] } } | { kind: 'create'; doc: Doc }> = []
    const tx = {
      patch: (id: string, v: { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] }) => (ops.push({ kind: 'patch', id, v }), tx),
      createIfNotExists: (doc: Doc) => (ops.push({ kind: 'create', doc }), tx),
      commit: vi.fn(async (o: { transactionId?: string } = {}) => {
        await Promise.resolve()
        if (failNextCommits > 0) {
          failNextCommits--
          // A concurrent writer won: bump the revision so the next read sees a new one.
          const d = store.get(DOC_ID)
          if (d) store.set(DOC_ID, { ...d, _rev: nextRev() })
          throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
        }
        for (const op of ops) if (op.kind === 'patch') {
          const cur = store.get(op.id)
          if (!cur) throw Object.assign(new Error('missing'), { statusCode: 404 })
          if (op.v.ifRevisionID && cur._rev !== op.v.ifRevisionID) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
        }
        for (const op of ops) {
          if (op.kind === 'create') {
            if (!store.has(op.doc._id)) store.set(op.doc._id, { ...structuredClone(op.doc), _rev: nextRev() })
            continue
          }
          const next: Doc = { ...store.get(op.id)!, ...structuredClone(op.v.set ?? {}), _rev: nextRev() }
          for (const k of op.v.unset ?? []) delete next[k]
          store.set(op.id, next)
        }
        commits.push({ transactionId: o.transactionId, ops: structuredClone(ops) })
        return {}
      }),
    }
    return tx
  })
  const client = { fetch, transaction }
  const deps: CatalogueTaxonomyDeps = {
    client: client as never,
    now: () => new Date('2026-11-03T09:00:00Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
    audit: async (e) => void audits.push(e),
    sources: [],
    sleep: async () => {},
  }
  const doc = () => store.get(DOC_ID)
  const keys = () => ((doc()?.categories as Array<{ key: string }>) ?? []).map((c) => c.key)
  const row = (key: string) => ((doc()?.categories as Array<Record<string, unknown>>) ?? []).find((c) => c.key === key)
  return {
    store, deps, client, commits, audits, doc, keys, row,
    failNext: (n = 1) => void (failNextCommits = n),
    hook: (h: (q: string, p: Record<string, unknown>) => unknown | undefined) => queryHooks.push(h),
    calls: () => fetch.mock.calls.length + transaction.mock.calls.length,
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof CatalogueTaxonomyError) return e.code
    if (e instanceof CatalogueForbidden) return `forbidden:${e.capability}`
    if (e instanceof TenantAuthorizationError) return 'forbidden'
    throw e
  }
}
async function caught<E>(p: Promise<unknown>): Promise<E> {
  try {
    await p
  } catch (e) {
    return e as E
  }
  throw new Error('expected a rejection')
}

const P = 'project-a'
let f: ReturnType<typeof fake>
beforeEach(() => {
  f = fake([taxonomyDoc()])
})

// ── perm/* (C1.11, C8 P-12) ─────────────────────────────────────────────────

describe('perm/editor-ops — catalogue.taxonomy.write', () => {
  it('create, rename, translate, reorder siblings, delete an unreferenced leaf and every tag operation', async () => {
    const c = await createCategory(editor(), P, { labels: { en: 'Focacce' }, parentKey: 'pizza' }, f.deps)
    expect(c.created).toBe(true)
    const list = await listTaxonomy(editor(), P, f.deps)
    expect(list.can).toEqual({ write: true, manage: false })
    const r1 = await updateCategory(editor(), P, { key: 'focacce', labels: { it: 'Focacce' }, rev: list.rev }, f.deps)
    const r2 = await reorderChildren(editor(), P, { parentKey: 'pizza', keys: ['focacce'], rev: r1.rev }, f.deps)
    expect(r2.order.map((o) => o.key)).toEqual(['focacce', 'pizza_classiche', 'pizza_bianche'])
    expect((await deleteCategory(editor(), P, { key: 'liqueurs' }, f.deps)).deleted).toBe(true)
    const t = await createTag(editor(), P, { labels: { en: 'Vegan' } }, f.deps)
    const t2 = await updateTag(editor(), P, { key: t.tag.key, labels: { it: 'Vegano' }, rev: t.rev }, f.deps)
    await reorderTags(editor(), P, { keys: ['vegan'], rev: t2.rev }, f.deps)
    await archiveTag(editor(), P, { key: 'vegan' }, f.deps)
    expect((await deleteTag(editor(), P, { key: 'vegan' }, f.deps)).deleted).toBe(true)
    expect(f.keys()).not.toContain('liqueurs')
  })
})

describe('perm/setup-ops — P-12 / P-16 / P-22: setup.manage only, zero I/O for an editor', () => {
  it.each([
    ['moveCategory', () => moveCategory(editor(), P, { key: 'pizza', newParentKey: 'beverages', rev: 'r0' }, f.deps)],
    ['setCategoryRule', () => setCategoryRule(editor(), P, { key: 'food', channel: 'delivery', rule: { state: 'available' }, rev: 'r0' }, f.deps)],
    ['previewCategoryRule', () => previewCategoryRule(editor(), P, { key: 'food', channel: 'delivery', rule: null }, f.deps)],
    ['archiveCategory', () => archiveCategory(editor(), P, { key: 'pizza' }, f.deps)],
    ['reassignCategory', () => reassignCategory(editor(), P, { from: 'pizza_bianche', to: 'pizza' }, f.deps)],
    ['pruneChannelFromCategories', () => pruneChannelFromCategories(editor(), P, 'delivery', f.deps)],
  ])('%s → refused naming catalogue.setup.manage', async (_name, run) => {
    expect(await code(run())).toBe('forbidden:catalogue.setup.manage')
    expect(f.calls()).toBe(0)
  })

  it('a viewer may list but not add (refusal names catalogue.taxonomy.write)', async () => {
    await listTaxonomy(viewer(), P, f.deps)
    const before = f.calls()
    expect(await code(createCategory(viewer(), P, { labels: { en: 'X' }, parentKey: null }, f.deps))).toBe('forbidden:catalogue.taxonomy.write')
    expect(f.calls()).toBe(before)
  })

  it('without the Catalogue installed: the generic refusal, naming no capability (C8 §8.6)', async () => {
    const e = await caught<Error>(createCategory(ctxOf(grant({ enabledModuleIds: [] })), P, { labels: { en: 'X' }, parentKey: null }, f.deps))
    expect(e).toBeInstanceOf(TenantAuthorizationError)
    expect(e).not.toBeInstanceOf(CatalogueForbidden)
  })

  it('support mode: an approved support edit may manage categories (allergen/export are never — C8 §8.7)', async () => {
    const ctx = { ...owner(), support: { purpose: 'mutation', writesAllowed: true } } as unknown as TenantAuthorizationContext
    expect(await code(archiveCategory(ctx, P, { key: 'desserts' }, f.deps))).toBe('ok')
    const view = { ...owner(), support: { purpose: 'mutation', writesAllowed: false } } as unknown as TenantAuthorizationContext
    expect(await code(archiveCategory(view, P, { key: 'desserts' }, f.deps))).toBe('forbidden:catalogue.setup.manage')
  })
})

// ── seeding (C1.9 R2) ────────────────────────────────────────────────────────

describe('first write seeds catalogue-taxonomy.<slug> from the term records', () => {
  const terms = [
    { kind: 'category', key: 'technology', label: { _type: 'localizedString', en: 'Technology' }, order: 1000 },
    { kind: 'category', key: 'literature', label: { _type: 'localizedString', en: 'Literature' }, order: 3000 },
    { kind: 'tag', key: 'illustrated_boos', label: { _type: 'localizedString', en: 'Illustrated books' }, order: 1000 },
  ] as unknown as Doc[]

  it('list shows the seed while the document does not exist; the first write creates it with keys verbatim', async () => {
    const g = fake([], { terms })
    const list = await listTaxonomy(owner(), P, g.deps)
    expect(list.exists).toBe(false)
    expect(list.rev).toBe('')
    expect(list.categories.map((c) => c.key)).toEqual(['technology', 'literature'])
    await createCategory(owner(), P, { labels: { en: 'Design' }, parentKey: null }, g.deps)
    expect(g.commits[0].ops).toMatchObject([{ kind: 'create', doc: { _id: DOC_ID, _type: 'catalogueTaxonomy', projectSlug: SLUG } }])
    expect(g.commits[0].transactionId).toMatch(/^abluo-setup-seed-/)
    expect(g.keys()).toEqual(['technology', 'literature', 'design'])
    expect(((g.doc()!.tags as Array<{ key: string }>) ?? []).map((t) => t.key)).toEqual(['illustrated_boos'])
  })

  it('a user op sent with the virtual rev "" is accepted right after the seed', async () => {
    const g = fake([], { terms })
    const r = await updateCategory(owner(), P, { key: 'technology', labels: { it: 'Tecnologia' }, rev: '' }, g.deps)
    expect(r.category.label).toEqual({ en: 'Technology', it: 'Tecnologia' })
  })

  it('never overwrites an existing document', async () => {
    await createCategory(owner(), P, { labels: { en: 'Soups' }, parentKey: null }, f.deps)
    expect(f.commits.every((c) => !(c.ops as Array<{ kind: string }>).some((o) => o.kind === 'create'))).toBe(true)
  })
})

// ── create / inline (C1.11 inline/*, P-21) ───────────────────────────────────

describe('inline/create-path and inline/parent-required', () => {
  it('returns the complete path; top level is an explicit null', async () => {
    const r = await createCategory(owner(), P, { labels: { en: 'Focacce' }, parentKey: 'pizza' }, f.deps)
    expect(r.path.text).toBe('Food › Pizza › Focacce')
    expect(f.row('focacce')).toMatchObject({ _key: 'focacce', _type: 'catalogueCategory', parentKey: 'pizza', order: 3000 })
    expect(f.row('focacce')!.channelRules).toBeUndefined() // created with inherit (D-3)
    const top = await createCategory(owner(), P, { labels: { en: 'Soups' }, parentKey: null, index: 0 }, f.deps)
    expect(top.path.text).toBe('Soups')
    expect(f.row('soups')!.parentKey).toBeUndefined()
    expect(f.row('soups')!.order).toBeLessThan(1000)
  })

  it('undefined parent is refused; unknown / archived parent are typed codes', async () => {
    expect(await code(createCategory(owner(), P, { labels: { en: 'X' } } as never, f.deps))).toBe('invalid_input')
    expect(await code(createCategory(owner(), P, { labels: { en: 'X' }, parentKey: 'nope' }, f.deps))).toBe('category_parent_unknown')
    await archiveCategory(owner(), P, { key: 'desserts' }, f.deps)
    expect(await code(createCategory(owner(), P, { labels: { en: 'X' }, parentKey: 'desserts' }, f.deps))).toBe('category_archived_parent')
  })

  it('a twin under the same parent is returned, not duplicated; a cousin may share a name', async () => {
    const commits = f.commits.length
    const r = await createCategory(owner(), P, { labels: { en: '  white ' }, parentKey: 'pizza' }, f.deps)
    expect(r).toMatchObject({ created: false, category: { key: 'pizza_bianche' } })
    expect(f.commits.length).toBe(commits)
    expect((await createCategory(owner(), P, { labels: { en: 'White' }, parentKey: 'beverages' }, f.deps)).created).toBe(true)
  })

  it('labels: main language required, unknown language refused, too long refused', async () => {
    expect(await code(createCategory(owner(), P, { labels: { it: 'Solo italiano' }, parentKey: null }, f.deps))).toBe('category_label_required')
    expect(await code(createCategory(owner(), P, { labels: { en: 'X', fr: 'Y' }, parentKey: null }, f.deps))).toBe('invalid_input')
    expect(await code(createCategory(owner(), P, { labels: { en: 'x'.repeat(81) }, parentKey: null }, f.deps))).toBe('category_label_too_long')
  })

  it('rename refuses a duplicate sibling name; the key never changes', async () => {
    const list = await listTaxonomy(owner(), P, f.deps)
    expect(await code(updateCategory(owner(), P, { key: 'pizza_bianche', labels: { en: 'Classic' }, rev: list.rev }, f.deps))).toBe('category_label_duplicate_sibling')
    expect(await code(updateCategory(owner(), P, { key: 'pizza', labels: { en: 'P' }, nextKey: 'pz', rev: list.rev }, f.deps))).toBe('category_key_immutable')
  })
})

// ── concurrency (C1.7a) ──────────────────────────────────────────────────────

describe('conc/*', () => {
  it('conc/idempotent-retry: a 409 on create re-plans and retries; one node', async () => {
    f.failNext(1)
    await createCategory(owner(), P, { labels: { en: 'Focacce' }, parentKey: 'pizza' }, f.deps)
    expect(f.keys().filter((k) => k === 'focacce')).toHaveLength(1)
  })

  it('conc/user-conflict: a stale rev on rename → category_conflict with rev, tree and changedKeys; nothing written', async () => {
    const list = await listTaxonomy(owner(), P, f.deps)
    const base = { ...Object.fromEntries(list.categories.map((c) => [c.key, c.hash])), ...Object.fromEntries(list.tags.map((t) => [`tag:${t.key}`, t.hash])) }
    await updateCategory(owner(), P, { key: 'desserts', labels: { de: 'Nachspeisen' }, rev: list.rev }, f.deps) // someone else
    const commits = f.commits.length
    const e = await caught<CatalogueTaxonomyError>(updateCategory(owner(), P, { key: 'pizza', labels: { it: 'Pizze' }, rev: list.rev, baseHashes: base }, f.deps))
    expect(e.code).toBe('category_conflict')
    expect(e.detail?.rev).toBe(f.doc()!._rev)
    expect(e.detail?.tree?.map((n) => n.key)).toContain('pizza')
    expect(e.detail?.changedKeys).toEqual(['desserts'])
    expect(f.commits.length).toBe(commits)
  })

  it('conc/user-conflict: a 409 at commit on move is NOT retried', async () => {
    const list = await listTaxonomy(owner(), P, f.deps)
    f.failNext(1)
    const before = f.client.transaction.mock.calls.length
    expect(await code(moveCategory(owner(), P, { key: 'pizza', newParentKey: 'beverages', rev: list.rev }, f.deps))).toBe('category_conflict')
    expect(f.client.transaction.mock.calls.length - before).toBe(1)
  })

  it('conc/atomic-move: a move failing validation leaves the document byte-identical', async () => {
    const list = await listTaxonomy(owner(), P, f.deps)
    const snapshot = JSON.stringify(f.doc())
    expect(await code(moveCategory(owner(), P, { key: 'food', newParentKey: 'pizza_bianche', rev: list.rev }, f.deps))).toBe('category_cycle')
    expect(JSON.stringify(f.doc())).toBe(snapshot)
  })

  it('user ops require the rev they loaded', async () => {
    expect(await code(updateCategory(owner(), P, { key: 'pizza', labels: { it: 'Pizze' } } as never, f.deps))).toBe('invalid_input')
  })
})

// ── move (setup.manage, audited) ─────────────────────────────────────────────

describe('moveCategory', () => {
  it('re-parents in one guarded patch and records category.restructured with counts', async () => {
    const g = fake([taxonomyDoc(), item('i1', { primaryCategory: 'pizza_bianche', formats: [] }), item('drafts.i1', { primaryCategory: 'pizza_bianche' }), item('i2', { primaryCategory: 'desserts' })])
    const list = await listTaxonomy(owner(), P, g.deps)
    const r = await moveCategory(owner(), P, { key: 'pizza', newParentKey: 'beverages', index: 0, rev: list.rev }, g.deps)
    expect(r.category.parentKey).toBe('beverages')
    expect(r.impact.items).toBe(1) // i1 (draft + published count once)
    expect(g.commits.at(-1)!.transactionId).toMatch(/^abluo-setup-moveCategory-/)
    expect(g.audits).toHaveLength(1)
    expect(g.audits[0]).toMatchObject({ kind: 'category.restructured', scope: 'category', targetId: 'pizza', detail: { op: 'move', fromParent: 'food', toParent: 'beverages', impact: { items: 1 } } })
    expect(g.audits[0].transactionId).toBe(g.commits.at(-1)!.transactionId)
  })
})

// ── rules incl. schedules (D-6, C5a; setup.manage) ───────────────────────────

describe('category channel rules', () => {
  const g = () =>
    fake([
      taxonomyDoc(),
      item('a', { primaryCategory: 'pizza_bianche', formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [] }] }),
      item('b', { primaryCategory: 'desserts', formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [] }], channelAvailability: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable' }] }),
      item('c', { primaryCategory: 'liqueurs', archivedAt: '2026-01-01T00:00:00Z' }),
    ])

  it('preview counts the impact (C5-6) and writes nothing; apply stores the stored shape and audits it content-free', async () => {
    const h = g()
    const rule = { state: 'unavailable', overrides: [{ key: 'dinner', from: '18:00', to: '23:00', state: 'available' }] }
    const preview = await previewCategoryRule(owner(), P, { key: 'food', channel: 'delivery', rule }, h.deps)
    expect(preview.before).toBe('inherit')
    expect(h.commits).toHaveLength(0)
    expect(preview.impact).toMatchObject({ items: 1, formats: 1, shieldedByOverride: 1 })
    const list = await listTaxonomy(owner(), P, h.deps)
    const r = await setCategoryRule(owner(), P, { key: 'food', channel: 'delivery', rule, rev: list.rev }, h.deps)
    expect(r.impact).toEqual(preview.impact)
    expect(h.row('food')!.channelRules).toEqual([
      { _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable', schedule: [{ _key: 'dinner', _type: 'catalogueWeeklyOverride', from: '18:00', to: '23:00', state: 'available' }] },
    ])
    const row = h.audits.find((a) => a.kind === 'category.rule_changed')!
    expect(row).toMatchObject({ scope: 'category', targetId: 'food', detail: { categoryKey: 'food', channel: 'delivery', before: 'inherit', after: { baseline: 'unavailable', overrides: 1, daysCovered: 7 } } })
    expect(JSON.stringify(row.detail)).not.toMatch(/18:00|23:00|Food|dinner/)
    expect(validateAuditDetail('category.rule_changed', row.detail)).toBe(true)
  })

  it('rule/schedule-invalid: overlapping overrides → category_rule_schedule_invalid (C5a code); unknown channel refused', async () => {
    const h = g()
    const list = await listTaxonomy(owner(), P, h.deps)
    const overlap = { state: 'unavailable', overrides: [{ from: '18:00', to: '22:00', state: 'available' }, { from: '21:00', to: '23:00', state: 'available' }] }
    const e = await caught<CatalogueTaxonomyError>(setCategoryRule(owner(), P, { key: 'food', channel: 'delivery', rule: overlap, rev: list.rev }, h.deps))
    expect(e.code).toBe('category_rule_schedule_invalid')
    expect(e.detail?.code).toBe('availability.scheduleOverlap')
    expect(await code(setCategoryRule(owner(), P, { key: 'food', channel: 'room', rule: { state: 'available' }, rev: list.rev }, h.deps))).toBe('category_rule_unknown_channel')
  })

  it('rule: null restores inheritance; pruning a channel removes every row naming it (idempotent)', async () => {
    const h = fake([taxonomyDoc([cat('food', { en: 'Food' }, null, 1000, { channelRules: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'available' }] })])])
    expect((await pruneChannelFromCategories(owner(), P, 'delivery', h.deps)).removed).toBe(1)
    expect(h.row('food')!.channelRules).toBeUndefined()
    expect((await pruneChannelFromCategories(owner(), P, 'delivery', h.deps)).removed).toBe(0)
  })
})

// ── delete (D-3, P-19, P-20) ────────────────────────────────────────────────

describe('deleteCategory', () => {
  const withItems = () =>
    fake([
      taxonomyDoc(),
      item('i1', { primaryCategory: 'pizza_bianche' }),
      item('drafts.i1', { primaryCategory: 'pizza_bianche', additionalCategories: ['desserts'] }),
      item('i2', { categories: ['desserts', 'pizza_bianche'] }), // legacy shape: additional
      item('drafts.i3', { primaryCategory: 'liqueurs' }), // draft-only item
    ])

  it('delete/route-editor: an editor deletes an unreferenced leaf', async () => {
    const r = await deleteCategory(editor(), P, { key: 'pizza_classiche' }, f.deps)
    expect(r.deleted).toBe(true)
    expect(f.keys()).not.toContain('pizza_classiche')
  })

  it('P-19 / delete/route-setup: in use (draft-only item), or with a child → editor refused naming setup.manage, zero writes', async () => {
    const g = withItems()
    for (const key of ['liqueurs', 'pizza']) {
      const e = await caught<CatalogueTaxonomyError>(deleteCategory(editor(), P, { key }, g.deps))
      expect(e.code).toBe('category_setup_required')
      expect(e.detail?.capability).toBe('catalogue.setup.manage')
    }
    expect(g.commits).toHaveLength(0)
  })

  it('P-20 delete race: usage is re-read just before the guarded write; nothing is deleted', async () => {
    let refsCalls = 0
    f.hook((q) => {
      if (!q.includes('primaryCategory == $key')) return undefined
      refsCalls++
      // First gather (two item sources share the query) sees nothing; the recount sees a new draft.
      return refsCalls <= 2 ? [] : [{ _id: 'drafts.new', name: 'New', primaryCategory: 'pizza_classiche' }]
    })
    expect(await code(deleteCategory(editor(), P, { key: 'pizza_classiche' }, f.deps))).toBe('category_setup_required')
    expect(f.keys()).toContain('pizza_classiche')
    expect(refsCalls).toBe(4)
  })

  it('with setup.manage: a choice is required, then items are reassigned (new shape, legacy unset) and the node removed', async () => {
    const g = withItems()
    expect(await code(deleteCategory(owner(), P, { key: 'pizza_bianche' }, g.deps))).toBe('category_in_use')
    const preview = await previewCategoryDeletion(owner(), P, { key: 'pizza_bianche', reassignTo: 'pizza' }, g.deps)
    expect(preview.route).toEqual({ capability: 'setup.manage', resolvable: true })
    expect(preview.plan).toEqual({ ok: true, steps: [{ kind: 'reassign_items', count: 2 }] })
    expect(g.commits).toHaveLength(0)
    const r = await deleteCategory(owner(), P, { key: 'pizza_bianche', reassignTo: 'pizza' }, g.deps)
    expect(r).toMatchObject({ deleted: true, reassigned: 3 })
    expect(g.store.get('i1')).toMatchObject({ primaryCategory: 'pizza' })
    expect(g.store.get('drafts.i1')).toMatchObject({ primaryCategory: 'pizza', additionalCategories: ['desserts'] })
    expect(g.store.get('i2')).toMatchObject({ primaryCategory: 'desserts', additionalCategories: ['pizza'] })
    expect(g.store.get('i2')!.categories).toBeUndefined()
    expect(g.keys()).not.toContain('pizza_bianche')
    expect(g.audits.map((a) => a.kind)).toEqual(['category.restructured'])
    expect(g.audits[0].detail).toMatchObject({ op: 'delete', categoryKey: 'pizza_bianche', reassignedTo: 'pizza', impact: { items: 3 } })
    expect(g.commits.every((c) => /^abluo-setup-/.test(c.transactionId ?? ''))).toBe(true)
  })

  it('children move to the parent in the same patch that removes the node', async () => {
    const r = await deleteCategory(owner(), P, { key: 'pizza', promoteChildrenTo: 'parent', reassignTo: null }, f.deps)
    expect(r).toMatchObject({ deleted: true, childrenMoved: 2 })
    expect(f.row('pizza_classiche')!.parentKey).toBe('food')
    expect(f.row('pizza_bianche')!.parentKey).toBe('food')
  })

  it('reassignCategory ("merge") and an already-absent key (idempotent)', async () => {
    const g = withItems()
    const r = await reassignCategory(owner(), P, { from: 'liqueurs', to: 'alcoholic' }, g.deps)
    expect(r.deleted).toBe(true)
    expect(g.store.get('drafts.i3')).toMatchObject({ primaryCategory: 'alcoholic' })
    expect(g.audits[0].detail).toMatchObject({ op: 'reassign' })
    expect((await deleteCategory(owner(), P, { key: 'liqueurs' }, g.deps)).deleted).toBe(false)
  })

  it('a reference source without cleanup is unresolvable (C1.11 delete/unresolvable)', async () => {
    const deps = { ...f.deps, sources: [{ id: 'x-future', kind: 'other' as const, stores: [], find: async () => ({ count: 1, sample: [] }) }] }
    expect(await code(deleteCategory(owner(), P, { key: 'liqueurs' }, deps))).toBe('category_cleanup_unresolvable')
    const usage = await categoryUsage(editor(), P, { key: 'liqueurs' }, deps)
    expect(usage.route).toEqual({ capability: 'setup.manage', resolvable: false })
  })
})

// ── tags ─────────────────────────────────────────────────────────────────────

describe('tags', () => {
  it('a used tag is not deleted (drafts count): tag_in_use with the count', async () => {
    const g = fake([taxonomyDoc(), item('drafts.x', { tags: ['spicy'] })])
    const e = await caught<CatalogueTaxonomyError>(deleteTag(owner(), P, { key: 'spicy' }, g.deps))
    expect(e.code).toBe('tag_in_use')
    expect(e.detail?.count).toBe(1)
  })

  it('a twin label returns the existing tag; tag keys are their own namespace', async () => {
    expect((await createTag(owner(), P, { labels: { en: 'SPICY' } }, f.deps)).created).toBe(false)
    expect((await createTag(owner(), P, { labels: { en: 'Pizza' } }, f.deps)).tag.key).toBe('pizza')
  })
})

describe('listTaxonomy', () => {
  it('tree order, depth, child and item counts (logical items, drafts included), hashes', async () => {
    const g = fake([taxonomyDoc(), item('i1', { primaryCategory: 'pizza', tags: ['spicy'] }), item('drafts.i1', { primaryCategory: 'pizza', tags: ['spicy'] })])
    const v = await listTaxonomy(owner(), P, g.deps)
    expect(v.categories.map((c) => c.key)).toEqual(['food', 'pizza', 'pizza_classiche', 'pizza_bianche', 'desserts', 'beverages', 'alcoholic', 'liqueurs'])
    const pizza = v.categories.find((c) => c.key === 'pizza')!
    expect(pizza).toMatchObject({ depth: 1, childCount: 2, items: 1 })
    expect(pizza.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(v.tags[0]).toMatchObject({ key: 'spicy', items: 1 })
    expect(v.channels.map((c) => c.key)).toEqual(['dine-in', 'delivery'])
  })
})
