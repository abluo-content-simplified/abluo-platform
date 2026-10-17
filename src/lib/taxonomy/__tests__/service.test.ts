/**
 * Taxonomy service (ADR-033 Amendment J, slice 3): permissions are checked
 * before any I/O, a project can only ever reach its own terms, concurrent
 * creates never duplicate, keys never change, and a used term is never deleted.
 * Sanity is an in-memory fake that honours $projectSlug the way GROQ would.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest } from '@/lib/modules/types'
import { MAX_TERMS_PER_KIND } from '../rules'
import { TaxonomyError, createTerm, deleteTerm, listTerms, reorderTerms, updateTerm, type TaxonomyDeps, type TaxonomyErrorCode } from '../service'

const SLUG = 'trattoria'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['catalogue.item.read', 'catalogue.taxonomy.write'],
  enabledModuleIds: ['catalogue'],
  ...o,
})
const ctxOf = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const owner = () => ctxOf(grant())
const editor = () => ctxOf(grant({ role: 'editor' }))
const viewer = () => ctxOf(grant({ role: 'viewer', permissions: ['catalogue.item.read'] }))
const notInstalled = () => ctxOf(grant({ enabledModuleIds: [] }))

type Doc = Record<string, unknown> & { _id: string }

function fake(seed: Doc[] = []) {
  const store = new Map<string, Doc>(seed.map((d) => [d._id, { _rev: 'r0', ...d }]))
  const fetchCalls: Array<{ q: string; params: Record<string, unknown>; opts: unknown }> = []
  let rev = 0
  const nextRev = () => `r${++rev}`

  const fetch = vi.fn(async (q: string, params: Record<string, unknown> = {}, opts?: unknown) => {
    fetchCalls.push({ q, params, opts })
    await Promise.resolve()
    const slug = params.projectSlug
    if (q.startsWith('count(*[_type == "project"')) return 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'en', 'de'] }
    const docs = [...store.values()]
    if (q.includes('_type == "taxonomyTerm"')) {
      return docs
        .filter((d) => d._type === 'taxonomyTerm' && d.projectSlug === slug && d.module === params.module && d.kind === params.kind)
        .sort((a, b) => Number(a.order) - Number(b.order))
    }
    if (q.includes('$key in coalesce(')) {
      const field = /coalesce\((\w+), \[\]\)/.exec(q)?.[1] ?? 'categories'
      return docs.filter((d) => d._type === 'catalogueItem' && d.projectSlug === slug && ((d[field] as string[]) ?? []).includes(params.key as string)).map((d) => ({ _id: d._id, _type: d._type, name: d.name }))
    }
    if (q.includes('select(')) {
      return docs.filter((d) => d._type === 'catalogueItem' && d.projectSlug === slug).map((d) => ({ _id: d._id, _type: d._type, keys: (d[/coalesce\((\w+), \[\]\)/.exec(q)?.[1] ?? 'categories'] as string[]) ?? [] }))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const createIfNotExists = vi.fn(async (doc: Doc) => {
    await Promise.resolve()
    const existing = store.get(doc._id)
    if (existing) return existing
    const stored = { ...doc, _rev: nextRev() }
    store.set(doc._id, stored)
    return stored
  })
  const patch = vi.fn((id: string) => {
    let guard: string | undefined
    let setV: Record<string, unknown> = {}
    let unsetV: string[] = []
    const b = {
      ifRevisionId: (r: string) => ((guard = r), b),
      set: (v: Record<string, unknown>) => ((setV = v), b),
      unset: (v: string[]) => ((unsetV = v), b),
      commit: vi.fn(async () => {
        const cur = store.get(id)
        if (!cur) throw Object.assign(new Error('missing'), { statusCode: 404 })
        if (guard && cur._rev !== guard) throw Object.assign(new Error('rev'), { statusCode: 409 })
        const next: Doc = { ...cur, ...setV, _rev: nextRev() }
        for (const k of unsetV) delete next[k]
        store.set(id, next)
        return next
      }),
    }
    return b
  })
  const transaction = vi.fn(() => {
    const ops: Array<[string, Record<string, unknown>]> = []
    const tx = {
      patch: (id: string, v: { set: Record<string, unknown> }) => (ops.push([id, v.set]), tx),
      commit: vi.fn(async () => {
        for (const [id, set] of ops) store.set(id, { ...store.get(id)!, ...set, _rev: nextRev() })
        return {}
      }),
    }
    return tx
  })
  const del = vi.fn(async (id: string) => void store.delete(id))
  const client = { getDocument: vi.fn(async (id: string) => store.get(id)), fetch, createIfNotExists, patch, transaction, delete: del }
  const deps: TaxonomyDeps = { client: client as never, now: () => new Date('2026-10-17T09:00:00Z') }
  const terms = (slug = SLUG) => [...store.values()].filter((d) => d._type === 'taxonomyTerm' && d.projectSlug === slug)
  const touched = () => fetch.mock.calls.length + client.getDocument.mock.calls.length + createIfNotExists.mock.calls.length + patch.mock.calls.length + transaction.mock.calls.length + del.mock.calls.length
  return { client, deps, store, fetchCalls, terms, touched }
}

const term = (key: string, label: Record<string, string>, o: Record<string, unknown> = {}): Doc => ({
  _id: `term.${SLUG}.catalogue.category.${key}`,
  _type: 'taxonomyTerm',
  projectSlug: SLUG,
  module: 'catalogue',
  kind: 'category',
  key,
  label: { _type: 'localizedString', ...label },
  order: 1000,
  ...o,
})
const item = (id: string, categories: string[], o: Record<string, unknown> = {}): Doc => ({ _id: id, _type: 'catalogueItem', projectSlug: SLUG, categories, name: { _type: 'localizedString', it: id }, ...o })

async function code(p: Promise<unknown>): Promise<TaxonomyErrorCode | 'other'> {
  try {
    await p
    return 'other'
  } catch (e) {
    return e instanceof TaxonomyError ? e.code : 'other'
  }
}

describe('permission matrix — checked before any I/O', () => {
  it('owner and editor may do everything the manifest allows', async () => {
    for (const c of [owner(), editor()]) {
      const f = fake([term('pizza', { it: 'Pizza' }), term('dolci', { it: 'Dolci' }, { order: 2000 })])
      expect((await listTerms(c, 'project-a', 'catalogue', 'category', f.deps)).canWrite).toBe(true)
      const created = await createTerm(c, 'project-a', 'catalogue', 'category', { labels: { it: 'Primi' } }, f.deps)
      expect(created.created).toBe(true)
      await updateTerm(c, 'project-a', 'catalogue', 'category', 'pizza', { labels: { en: 'Pizza' } }, f.deps)
      await reorderTerms(c, 'project-a', 'catalogue', 'category', ['dolci', 'pizza'], f.deps)
      await deleteTerm(c, 'project-a', 'catalogue', 'category', 'dolci', f.deps)
    }
  })

  it('a viewer may list (read permission) but every write is refused with no Sanity call', async () => {
    const f = fake([term('pizza', { it: 'Pizza' })])
    const list = await listTerms(viewer(), 'project-a', 'catalogue', 'category', f.deps)
    expect(list.canWrite).toBe(false)
    expect(list.terms).toHaveLength(1)
    const before = f.touched()
    const c = viewer()
    await expect(createTerm(c, 'project-a', 'catalogue', 'category', { labels: { it: 'x' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(updateTerm(c, 'project-a', 'catalogue', 'category', 'pizza', { labels: { en: 'x' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(reorderTerms(c, 'project-a', 'catalogue', 'category', ['pizza'], f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(deleteTerm(c, 'project-a', 'catalogue', 'category', 'pizza', f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.touched()).toBe(before)
  })

  it('a module that is not installed refuses reads and writes with no Sanity call', async () => {
    const f = fake([term('pizza', { it: 'Pizza' })])
    const c = notInstalled()
    await expect(listTerms(c, 'project-a', 'catalogue', 'category', f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(createTerm(c, 'project-a', 'catalogue', 'category', { labels: { it: 'x' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(deleteTerm(c, 'project-a', 'catalogue', 'category', 'pizza', f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.touched()).toBe(0)
  })

  it('a project the caller has no grant on is refused', async () => {
    const f = fake()
    await expect(createTerm(owner(), 'project-zzz', 'catalogue', 'category', { labels: { it: 'x' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.touched()).toBe(0)
  })

  it('a kind the module does not declare is refused', async () => {
    const f = fake()
    const base = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
    const registry: ModuleManifest[] = [{ ...base, taxonomies: [{ kind: 'category', usedBy: [{ type: 'catalogueItem', field: 'categories' }] }] }]
    const deps = { ...f.deps, registry }
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'tag', { labels: { it: 'x' } }, deps))).toBe('kind_not_declared')
    expect(await code(listTerms(owner(), 'project-a', 'catalogue', 'tag', deps))).toBe('kind_not_declared')
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'nonsense', { labels: { it: 'x' } }, f.deps))).toBe('invalid_value')
    expect(f.touched()).toBe(0)
  })

  it('an installed module that declares no taxonomies is refused even when the role holds the permission', async () => {
    const f = fake()
    const c = ctxOf(grant({ enabledModuleIds: ['gallery'], permissions: ['gallery.taxonomy.write'] }))
    expect(await code(createTerm(c, 'project-a', 'gallery', 'category', { labels: { it: 'x' } }, f.deps))).toBe('kind_not_declared')
    expect(f.touched()).toBe(0)
  })

  it('a module id that is not a slug is refused', async () => {
    const f = fake()
    expect(await code(createTerm(owner(), 'project-a', 'cata.logue', 'category', { labels: { it: 'x' } }, f.deps))).toBe('invalid_value')
    expect(f.touched()).toBe(0)
  })

  it('reads a custom manifest list (injected registry) and its declared colour', async () => {
    const base = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
    const registry: ModuleManifest[] = [{ ...base, taxonomies: [{ kind: 'category', usedBy: [{ type: 'catalogueItem', field: 'categories' }], color: true }] }]
    const f = fake([term('pizza', { it: 'Pizza' })])
    const r = await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { color: '#AABBCC' }, { ...f.deps, registry })
    expect(r.term.color).toBe('#aabbcc')
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { color: 'red' }, { ...f.deps, registry }))).toBe('invalid_value')
    const cleared = await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { color: null }, { ...f.deps, registry })
    expect(cleared.term.color).toBeNull()
  })
})

describe('isolation between projects', () => {
  const other = (key: string, label: Record<string, string>) => term(key, label, { _id: `term.other.catalogue.category.${key}`, projectSlug: 'other' })

  it("another project's term is never listed, updated, reordered or deleted", async () => {
    const f = fake([other('poesia', { it: 'Poesia' }), item('o1', ['poesia'], { projectSlug: 'other' })])
    expect((await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)).terms).toEqual([])
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'poesia', { labels: { en: 'x' } }, f.deps))).toBe('not_found')
    expect(await code(reorderTerms(owner(), 'project-a', 'catalogue', 'category', ['poesia'], f.deps))).toBe('not_found')
    expect(await code(deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'poesia', f.deps))).toBe('not_found')
    expect(f.store.has('term.other.catalogue.category.poesia')).toBe(true)
    expect(f.client.patch).not.toHaveBeenCalled()
    expect(f.client.delete).not.toHaveBeenCalled()
  })

  it('a record stored under our id but belonging to another project is treated as unknown', async () => {
    const spoof = term('poesia', { it: 'Poesia' }, { projectSlug: 'other' }) // our id, foreign projectSlug
    const f = fake([spoof])
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'poesia', { labels: { en: 'x' } }, f.deps))).toBe('not_found')
    expect(await code(deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'poesia', f.deps))).toBe('not_found')
  })

  it('ids embed the project, and the same label in two projects makes two separate records', async () => {
    const f = fake([other('poesia', { it: 'Poesia' })])
    const { term: t } = await createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Poesia' } }, f.deps)
    expect(t.id).toBe(`term.${SLUG}.catalogue.category.poesia`)
    expect(f.store.has('term.other.catalogue.category.poesia')).toBe(true)
    expect(f.terms('other')).toHaveLength(1)
    expect(f.terms()).toHaveLength(1)
  })

  it("another project's items neither block a delete nor inflate counts", async () => {
    const f = fake([term('poesia', { it: 'Poesia' }), item('o1', ['poesia'], { projectSlug: 'other' })])
    const list = await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)
    expect(list.terms[0].usedBy).toBe(0)
    await deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'poesia', f.deps)
    expect(f.terms()).toHaveLength(0)
  })

  it('every query goes out with the granted $projectSlug and usage queries use the raw perspective', async () => {
    const f = fake([term('pizza', { it: 'Pizza' }), item('i1', ['pizza'])])
    await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)
    await code(deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', f.deps))
    const scoped = f.fetchCalls.filter((c) => c.q.includes('$projectSlug') && !c.q.startsWith('count('))
    expect(scoped.length).toBeGreaterThan(0)
    for (const c of f.fetchCalls) expect(c.params.projectSlug).toBe(SLUG)
    for (const c of f.fetchCalls.filter((x) => x.q.includes('$key in') || x.q.includes('select('))) expect(c.opts).toEqual({ perspective: 'raw' })
  })
})

describe('createTerm', () => {
  it('needs a label in the default language and derives the key from it', async () => {
    const f = fake()
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { en: 'Poetry' } }, f.deps))).toBe('label_required')
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: '   ' } }, f.deps))).toBe('label_required')
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'x'.repeat(81) } }, f.deps))).toBe('label_too_long')
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Ciao', fr: 'Salut' } }, f.deps))).toBe('invalid_value')
    expect(f.client.createIfNotExists).not.toHaveBeenCalled()
    const { term: t, created } = await createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: '  Fantascienza  ' } }, f.deps)
    expect(created).toBe(true)
    expect(t.key).toBe('fantascienza')
    expect(t.label).toEqual({ it: 'Fantascienza' })
    expect(t.order).toBe(1000)
    const stored = f.store.get(t.id)!
    expect(stored).toMatchObject({ _type: 'taxonomyTerm', projectSlug: SLUG, module: 'catalogue', kind: 'category', createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-10-17T09:00:00.000Z' })
    expect(t.coverage.missing).toEqual(['en', 'de'])
  })

  it('appends after the last term and takes the next free key on a different-label collision', async () => {
    const f = fake([term('cafe', { it: 'Cafe' }, { order: 3000 })])
    const { term: t } = await createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Café' } }, f.deps)
    expect(t.key).toBe('cafe_2')
    expect(t.order).toBe(4000)
  })

  it('returns the existing term for the same label instead of a near-duplicate', async () => {
    const f = fake([term('pizza', { it: 'Pizza' })])
    const r = await createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: ' pizza ' } }, f.deps)
    expect(r.created).toBe(false)
    expect(r.term.key).toBe('pizza')
    expect(f.client.createIfNotExists).not.toHaveBeenCalled()
    expect(f.terms()).toHaveLength(1)
  })

  it('refuses beyond the per-kind limit', async () => {
    const f = fake(Array.from({ length: MAX_TERMS_PER_KIND }, (_, i) => term(`t${i}`, { it: `T${i}` }, { order: i * 1000 })))
    expect(await code(createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'One more' } }, f.deps))).toBe('too_many_terms')
  })
})

describe('concurrent creates never duplicate', () => {
  it('two creates of the same label → one record', async () => {
    const f = fake()
    const [a, b] = await Promise.all([
      createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Letteratura' } }, f.deps),
      createTerm(editor(), 'project-a', 'catalogue', 'category', { labels: { it: 'Letteratura' } }, f.deps),
    ])
    expect(f.terms()).toHaveLength(1)
    expect(a.term.id).toBe(b.term.id)
  })

  it('two creates that land on the same key with different labels → suffixed keys, two records', async () => {
    const f = fake()
    const [a, b] = await Promise.all([
      createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Café' } }, f.deps),
      createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Cafe' } }, f.deps),
    ])
    expect(f.terms()).toHaveLength(2)
    expect(new Set([a.term.key, b.term.key])).toEqual(new Set(['cafe', 'cafe_2']))
    const ids = f.terms().map((d) => d._id)
    expect(new Set(ids).size).toBe(2)
  })

  it('many simultaneous creates of one label stay one record', async () => {
    const f = fake()
    await Promise.all(Array.from({ length: 8 }, () => createTerm(owner(), 'project-a', 'catalogue', 'category', { labels: { it: 'Storia' } }, f.deps)))
    expect(f.terms()).toHaveLength(1)
  })
})

describe('updateTerm', () => {
  it('changes labels per language without touching the key, id or order', async () => {
    const f = fake([term('pizza', { it: 'Pizza' }, { order: 2000 })])
    const { term: t } = await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { en: ' Pizza ', it: 'Pizze' } }, f.deps)
    expect(t.key).toBe('pizza')
    expect(t.id).toBe(`term.${SLUG}.catalogue.category.pizza`)
    expect(t.label).toEqual({ it: 'Pizze', en: 'Pizza' })
    expect(f.store.get(t.id)).toMatchObject({ key: 'pizza', order: 2000, updatedBy: 'u1', updatedAt: '2026-10-17T09:00:00.000Z' })
    expect(t.coverage.missing).toEqual(['de'])
  })

  it('cannot change the key', async () => {
    const f = fake([term('pizza', { it: 'Pizza' })])
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { nextKey: 'pizze', labels: { it: 'Pizze' } }, f.deps))).toBe('key_immutable')
    expect(f.client.patch).not.toHaveBeenCalled()
    expect(f.store.get(`term.${SLUG}.catalogue.category.pizza`)!.key).toBe('pizza')
    // the same key passed back is not a change
    await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { nextKey: 'pizza', labels: { en: 'Pizza' } }, f.deps)
  })

  it('keeps the default-language label, drops others on request, refuses unknown languages', async () => {
    const f = fake([term('pizza', { it: 'Pizza', en: 'Pizza' })])
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { it: '' } }, f.deps))).toBe('label_required')
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { fr: 'Pizza' } }, f.deps))).toBe('invalid_value')
    const { term: t } = await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { en: null } }, f.deps)
    expect(t.label).toEqual({ it: 'Pizza' })
  })

  it('refuses a stale revision with conflict, and a colour on a kind without colours', async () => {
    const f = fake([term('pizza', { it: 'Pizza' })])
    await updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { en: 'Pizza' } }, f.deps)
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { labels: { de: 'Pizza' }, rev: 'r0' }, f.deps))).toBe('conflict')
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', { color: '#ffffff' }, f.deps))).toBe('invalid_value')
  })

  it('unknown key → not_found', async () => {
    const f = fake()
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'nope', { labels: { en: 'x' } }, f.deps))).toBe('not_found')
    expect(await code(updateTerm(owner(), 'project-a', 'catalogue', 'category', 'No Way!', { labels: { en: 'x' } }, f.deps))).toBe('invalid_value')
  })
})

describe('reorderTerms', () => {
  it('lists keys first in order, appends unlisted terms, writes only what moved', async () => {
    const f = fake([term('a', { it: 'A' }, { order: 1000 }), term('b', { it: 'B' }, { order: 2000 }), term('c', { it: 'C' }, { order: 3000 })])
    const r = await reorderTerms(owner(), 'project-a', 'catalogue', 'category', ['c', 'a'], f.deps)
    expect(r.order).toEqual([
      { key: 'c', order: 1000 },
      { key: 'a', order: 2000 },
      { key: 'b', order: 3000 },
    ])
    const list = await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)
    expect(list.terms.map((t) => t.key)).toEqual(['c', 'a', 'b'])
  })

  it('refuses duplicates and unknown keys', async () => {
    const f = fake([term('a', { it: 'A' })])
    expect(await code(reorderTerms(owner(), 'project-a', 'catalogue', 'category', ['a', 'a'], f.deps))).toBe('invalid_value')
    expect(await code(reorderTerms(owner(), 'project-a', 'catalogue', 'category', ['zzz'], f.deps))).toBe('not_found')
    expect(f.client.transaction).not.toHaveBeenCalled()
  })
})

describe('deleteTerm — blocked while used', () => {
  const inUse = async (items: Doc[]) => {
    const f = fake([term('pizza', { it: 'Pizza' }), ...items])
    try {
      await deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'pizza', f.deps)
      return { f, error: null as TaxonomyError | null }
    } catch (e) {
      return { f, error: e as TaxonomyError }
    }
  }

  it('is allowed when nothing uses the term (other keys do not count)', async () => {
    const { f, error } = await inUse([item('i1', ['dolci'])])
    expect(error).toBeNull()
    expect(f.terms()).toHaveLength(0)
  })

  it('is refused when a published item uses it, naming the item', async () => {
    const { f, error } = await inUse([item('i1', ['pizza'], { name: { _type: 'localizedString', it: 'Margherita' } })])
    expect(error).toBeInstanceOf(TaxonomyError)
    expect(error!.code).toBe('in_use')
    expect(error!.detail).toEqual({ count: 1, items: [{ id: 'i1', type: 'catalogueItem', name: 'Margherita' }] })
    expect(f.client.delete).not.toHaveBeenCalled()
    expect(f.terms()).toHaveLength(1)
  })

  it('is refused when only a DRAFT item uses it', async () => {
    const { error } = await inUse([item('drafts.i2', ['pizza'])])
    expect(error!.code).toBe('in_use')
    expect(error!.detail!.items).toEqual([{ id: 'i2', type: 'catalogueItem', name: 'drafts.i2' }])
  })

  it('is refused when only an ARCHIVED item uses it', async () => {
    const { error } = await inUse([item('i3', ['pizza'], { archivedAt: '2026-10-01T00:00:00Z' })])
    expect(error!.code).toBe('in_use')
    expect(error!.detail!.count).toBe(1)
  })

  it('counts a draft and its published copy once, and reports at most 10 items', async () => {
    const items = [item('i1', ['pizza']), item('drafts.i1', ['pizza'])]
    for (let n = 2; n <= 12; n++) items.push(item(`n${n}`, ['pizza']))
    const { error } = await inUse(items)
    expect(error!.code).toBe('in_use')
    expect(error!.detail!.count).toBe(12)
    expect(error!.detail!.items).toHaveLength(10)
  })

  it('unknown term → not_found', async () => {
    const f = fake()
    expect(await code(deleteTerm(owner(), 'project-a', 'catalogue', 'category', 'nope', f.deps))).toBe('not_found')
  })
})

describe('listTerms — usage and coverage per enabled language', () => {
  it('reports usage (draft + published once, archived counted) and a chip per enabled language', async () => {
    const f = fake([
      term('pizza', { it: 'Pizza', en: 'Pizza', de: 'Pizza' }, { order: 1000 }),
      term('dolci', { it: 'Dolci', en: 'Sweets' }, { order: 2000 }),
      term('vini', { it: 'Vini', fr: 'Vins' }, { order: 3000 }), // fr is not an enabled language
      item('i1', ['pizza', 'dolci']),
      item('drafts.i1', ['pizza']),
      item('i2', ['pizza'], { archivedAt: '2026-10-01T00:00:00Z' }),
    ])
    const list = await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)
    expect(list.defaultLocale).toBe('it')
    expect(list.locales).toEqual(['it', 'en', 'de'])
    expect(list.terms.map((t) => [t.key, t.usedBy])).toEqual([['pizza', 2], ['dolci', 1], ['vini', 0]])
    expect(list.terms[0].coverage.isComplete).toBe(true)
    expect(list.terms[1].coverage.missing).toEqual(['de'])
    expect(list.terms[2].coverage.missing).toEqual(['en', 'de']) // a label in a disabled language does not count
    expect(list.summary).toEqual({ needTranslation: 2, total: 3 })
    expect(list.color).toBe(false)
  })
})

describe('kind "tag" (slice 7) — same service, the `tags` field', () => {
  const tagTerm = (key: string, label: Record<string, string>): Doc => term(key, label, { _id: `term.${SLUG}.catalogue.tag.${key}`, kind: 'tag' })
  const tagged = (id: string, tags: string[], o: Record<string, unknown> = {}): Doc => ({ ...item(id, [], o), tags })

  it('creates, lists (with usage from `tags`, not categories) and keeps categories apart', async () => {
    const f = fake([tagged('i1', ['regalo']), item('i2', ['regalo'])])
    const r = await createTerm(owner(), 'project-a', 'catalogue', 'tag', { labels: { it: 'Regalo' } }, f.deps)
    expect(r.term.key).toBe('regalo')
    expect(f.terms()[0]).toMatchObject({ _id: `term.${SLUG}.catalogue.tag.regalo`, kind: 'tag', module: 'catalogue' })
    const l = await listTerms(owner(), 'project-a', 'catalogue', 'tag', f.deps)
    expect(l.terms.map((t) => [t.key, t.usedBy])).toEqual([['regalo', 1]])
    expect((await listTerms(owner(), 'project-a', 'catalogue', 'category', f.deps)).terms).toEqual([])
  })

  it('delete is blocked while an item (draft, published or archived) carries the tag, and allowed otherwise', async () => {
    for (const it of [tagged('i1', ['regalo']), tagged('drafts.i2', ['regalo']), tagged('i3', ['regalo'], { archivedAt: '2026-10-01T00:00:00Z' })]) {
      const f = fake([tagTerm('regalo', { it: 'Regalo' }), it])
      expect(await code(deleteTerm(owner(), 'project-a', 'catalogue', 'tag', 'regalo', f.deps))).toBe('in_use')
      expect(f.client.delete).not.toHaveBeenCalled()
    }
    // an item that uses a CATEGORY with the same key does not block the tag
    const g = fake([tagTerm('regalo', { it: 'Regalo' }), item('i4', ['regalo'])])
    await deleteTerm(owner(), 'project-a', 'catalogue', 'tag', 'regalo', g.deps)
    expect(g.terms()).toHaveLength(0)
  })

  it('a viewer may not add tags', async () => {
    const f = fake()
    await expect(createTerm(viewer(), 'project-a', 'catalogue', 'tag', { labels: { it: 'x' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.client.createIfNotExists).not.toHaveBeenCalled()
  })
})
