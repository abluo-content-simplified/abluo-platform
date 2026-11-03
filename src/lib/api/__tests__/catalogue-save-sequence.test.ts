/**
 * Bug report 2026-11-03 (Tom, staging, tmz): a never-published legacy draft ("Pizza Margherita",
 * D1–D4 already applied: legacy `offers`/`categories` still present beside `formats`/`primaryCategory`)
 * — change the price, add a category, Publish → "changed somewhere else", the category lost.
 *
 * These tests run the REAL save path end to end: the autosave engine (createAutosave) sending through
 * patchCatalogueDraft, then publishCatalogueDraft — against an in-memory Sanity that keeps revisions
 * and refuses a stale `ifRevisionId` with 409, as the real one does.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { patchCatalogueDraft, publishCatalogueDraft } from '../catalogue-drafts'
import { createAutosave } from '@/lib/client/autosave/engine'
import { createMemoryJournal, type JournalStorage } from '@/lib/client/autosave/journal'
import { catalogueEditorKey } from '@/lib/modules/catalogue/editor-key'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { CATALOGUE_SITE_QUERY } from '@/lib/modules/catalogue/dashboard-queries'

const SLUG = 'tmz'
const grant: ProjectGrant = {
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug(SLUG),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['catalogue.item.read', 'catalogue.item.write', 'catalogue.item.delete', 'catalogue.allergen.update', 'catalogue.taxonomy.write'],
  enabledModuleIds: ['catalogue'],
}
const ctx: TenantAuthorizationContext = { userId: 'u1', platformRole: 'tenant_user', projects: [grant] }

const MIGRATED = { taxonomy: '2026-11-02T10:00:00Z', commerce: '2026-11-02T10:00:00Z', packHistory: '2026-11-02T10:00:00Z', publicName: '2026-11-02T10:00:00Z' }
const CONFIG = { currency: 'EUR', serviceChannels: [], categories: [{ value: 'design', label: { en: 'Design' } }, { value: 'typography', label: { en: 'Typography' } }], tags: [{ value: 'humour', label: { en: 'Humour' } }], catalogueMigrations: MIGRATED, publicName: { en: 'Shop' } }
const TAXONOMY = {
  _id: `catalogue-taxonomy.${SLUG}`,
  categories: [
    { _key: 'design', key: 'design', label: { en: 'Design' }, order: 1000 },
    { _key: 'typography', key: 'typography', label: { en: 'Typography' }, order: 2000 },
  ],
  tags: [{ _key: 'humour', key: 'humour', label: { en: 'Humour' }, order: 1000 }],
}

type Doc = Record<string, unknown> & { _id: string }

/** Sets one dotted path (`name.en`, `formats`) on a plain object. */
function setPath(doc: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cur = doc
  for (const p of parts.slice(0, -1)) cur = (cur[p] && typeof cur[p] === 'object' ? cur[p] : (cur[p] = {})) as Record<string, unknown>
  cur[parts[parts.length - 1]] = structuredClone(value)
}
function unsetPath(doc: Record<string, unknown>, path: string) {
  const parts = path.split('.')
  let cur: Record<string, unknown> | undefined = doc
  for (const p of parts.slice(0, -1)) cur = cur?.[p] as Record<string, unknown> | undefined
  if (cur) delete cur[parts[parts.length - 1]]
}

/** In-memory Sanity: revisions on every write, `ifRevisionId` → 409, transactions all or nothing. */
function sanity(seed: Doc[]) {
  const taxonomy = structuredClone(TAXONOMY)
  const store = new Map<string, Doc>(seed.map((d) => [d._id, structuredClone(d)]))
  let n = 0
  const nextRev = () => `rev-${++n}`
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q === CATALOGUE_SITE_QUERY) return { site: { defaultLocale: 'en', supportedLocales: ['en'], timeZone: 'Europe/Rome' }, config: CONFIG, translate: false, presetId: null, categoryTerms: [], tagTerms: [], taxonomy: structuredClone(taxonomy) }
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.includes('"mediaAsset"')) return p.ids
    if (q.includes('hasPage == true')) return []
    if (q.includes('(_id in $ids || _id in $draftIds)') && q.includes('options[]')) return [...store.values()].filter((d) => d._type === 'catalogueOptionList' && ([...(p.ids as string[]), ...(p.draftIds as string[])] as string[]).includes(d._id))
    if (q.includes('(_id in $ids || _id in $draftIds)')) return [...store.values()].filter((d) => d._type === p.type && ([...(p.ids as string[]), ...(p.draftIds as string[])] as string[]).includes(d._id)).map((d) => ({ _id: d._id, hasPrice: false }))
    if (q.startsWith('count(')) return 0
    throw new Error(`unexpected query ${q.slice(0, 80)}`)
  })
  type Ops = { ifRev?: string; setIfMissing?: Record<string, unknown>; set?: Record<string, unknown>; unset?: string[] }
  const applyPatch = (target: Map<string, Doc>, id: string, ops: Ops) => {
    const doc = target.get(id)
    if (!doc) throw Object.assign(new Error(`missing ${id}`), { statusCode: 404 })
    if (ops.ifRev !== undefined && doc._rev !== ops.ifRev) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
    for (const [k, v] of Object.entries(ops.setIfMissing ?? {})) if ((doc as Record<string, unknown>)[k] === undefined) setPath(doc, k, v)
    for (const [k, v] of Object.entries(ops.set ?? {})) setPath(doc, k, v)
    for (const k of ops.unset ?? []) unsetPath(doc, k)
    doc._rev = nextRev()
    return doc
  }
  const patch = vi.fn((id: string) => {
    const ops: Ops = {}
    const pb = {
      ifRevisionId: (r: string) => ((ops.ifRev = r), pb),
      setIfMissing: (v: Record<string, unknown>) => ((ops.setIfMissing = { ...ops.setIfMissing, ...v }), pb),
      set: (v: Record<string, unknown>) => ((ops.set = { ...ops.set, ...v }), pb),
      unset: (v: string[]) => ((ops.unset = [...(ops.unset ?? []), ...v]), pb),
      commit: async () => structuredClone(applyPatch(store, id, ops)),
    }
    return pb
  })
  const transaction = vi.fn(() => {
    const steps: Array<(m: Map<string, Doc>) => Doc | null> = []
    const tx = {
      patch: (id: string, v: unknown) => {
        if (typeof v === 'function') {
          const ops: Ops = {}
          const b = { setIfMissing: (x: Record<string, unknown>) => ((ops.setIfMissing = x), b), set: (x: Record<string, unknown>) => ((ops.set = x), b), unset: (x: string[]) => ((ops.unset = x), b) }
          ;(v as (p: typeof b) => unknown)(b)
          steps.push((m) => applyPatch(m, id, ops))
        } else {
          const o = v as { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] }
          steps.push((m) => applyPatch(m, id, { ifRev: o.ifRevisionID, set: o.set, unset: o.unset }))
        }
        return tx
      },
      create: (d: Doc) => (steps.push((m) => {
        if (m.has(d._id)) throw Object.assign(new Error('exists'), { statusCode: 409 })
        const doc = { ...structuredClone(d), _rev: nextRev() }
        m.set(d._id, doc)
        return doc
      }), tx),
      createOrReplace: (d: Doc) => (steps.push((m) => {
        const doc = { ...structuredClone(d), _rev: nextRev() }
        m.set(d._id, doc)
        return doc
      }), tx),
      delete: (id: string) => (steps.push((m) => (m.delete(id), null)), tx),
      commit: async (opts: { returnDocuments?: boolean } = {}) => {
        const next = new Map([...store].map(([k, v]) => [k, structuredClone(v)]))
        const out = steps.map((s) => s(next)).filter((d): d is Doc => !!d)
        store.clear()
        for (const [k, v] of next) store.set(k, v)
        return opts.returnDocuments ? out.map((d) => structuredClone(d)) : {}
      },
    }
    return tx
  })
  const client = {
    getDocument: vi.fn(async (id: string) => (store.has(id) ? structuredClone(store.get(id)) : undefined)),
    fetch,
    create: vi.fn(),
    patch,
    transaction,
  }
  /** Inline "Add category" (the taxonomy service's write, seen by the next save's site read). */
  const addCategory = (key: string) => taxonomy.categories.push({ _key: key, key, label: { en: key }, order: 1000 * (taxonomy.categories.length + 1) })
  return { store, addCategory, deps: { client: client as never, uuid: () => 'pub-uuid', now: () => new Date('2026-11-03T10:00:00Z'), audit: async () => undefined, catalogueAudit: async () => undefined } }
}

const ID = 'ee333af2-f72f-4fed-879d-1953523154fa'
const LIST = '7592a74b-0000-4000-8000-000000000001'

/** Pizza Margherita exactly as Tom's staging draft (D1–D4 applied, legacy fields still present). */
const margherita = (o: Record<string, unknown> = {}): Doc => ({
  _id: `drafts.${ID}`,
  _type: 'catalogueItem',
  _rev: 'r-staging',
  projectSlug: SLUG,
  name: { _type: 'localizedString', en: 'Pizza Margherita' },
  itemProfile: 'foodOrDrink',
  categories: ['design'],
  primaryCategory: 'design',
  additionalCategories: [],
  offers: [{ _key: 'ytvq9gd8te9', _type: 'catalogueOffer', price: 3.33 }],
  formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'ytvq9gd8te9', _type: 'cataloguePrice', amount: 3.33 }] }],
  optionLists: [{ _key: 'vhtfc0xslbe', list: { _type: 'reference', _ref: LIST }, min: 0 }],
  allergenDeclaration: { status: 'containsListedAllergens', allergens: ['peanuts'], mayContain: ['soybeans'], note: { en: 'Ask us.' }, confirmed: true },
  tags: ['humour'],
  images: [{ _key: 'i1', _type: 'reference', _ref: 'media-1' }],
  hasPage: false,
  visibility: 'public',
  ...o,
})
const optionList: Doc = { _id: LIST, _type: 'catalogueOptionList', _rev: 'l1', projectSlug: SLUG, name: { en: 'Extras' }, options: [], publishedAt: '2026-10-01T00:00:00Z' }

/** The same item already published, legacy only (no D2 formats yet), no draft. */
const publishedLegacy = (o: Record<string, unknown> = {}): Doc => {
  const d = margherita({ _id: ID, _rev: 'live-1', publishedAt: '2026-10-01T00:00:00Z', publicId: 'pub-1', ...o })
  delete d.formats
  delete d.primaryCategory
  delete d.additionalCategories
  return d
}

/** A book, legacy-shaped draft. */
const book = (): Doc => {
  const d = margherita({ name: { _type: 'localizedString', en: 'Grid Systems' }, itemProfile: 'book', bookDetails: { author: 'Josef Müller-Brockmann', isbn: '9783721201451' } })
  delete d.allergenDeclaration
  delete d.optionLists
  return d
}

const priceSet = (amount: number) => ({ formats: [{ _key: 'default', prices: [{ _key: 'ytvq9gd8te9', amount }] }] })
const categorySet = (...additional: string[]) => ({ primaryCategory: 'design', additionalCategories: additional })

type Fake = ReturnType<typeof sanity>

/**
 * One mounted item editor: its autosave engine wired exactly as use-catalogue-draft's `send`
 * (a draft that exists → patch; a published document without draft → patch with `openFrom`),
 * and its Publish (flush, then publish with the engine's revision).
 */
function editor(f: Fake, snap: { rev: string; liveRev?: string }, storage: JournalStorage = createMemoryJournal()) {
  const states: string[] = []
  let liveRev = snap.rev ? '' : (snap.liveRev ?? '')
  const autosave = createAutosave({
    draftId: `catalogue:${ID}`,
    rev: snap.rev,
    storage,
    debounceMs: 10,
    onState: (s) => states.push(s),
    send: async (input) => {
      try {
        const opening = !input.rev && liveRev
        const r = await patchCatalogueDraft(ctx, 'project-a', 'item', { id: ID, rev: opening ? '' : input.rev, set: input.set, ...(opening ? { openFrom: liveRev } : {}) }, f.deps)
        liveRev = ''
        return { ok: true, rev: r.rev }
      } catch (e) {
        return { ok: false, error: (e as { code?: string }).code ?? 'failed' }
      }
    },
  })
  const publish = async (mode: 'now' | 'keep' = 'now') => {
    const saved = await autosave.flush()
    if (!saved) return { ok: false as const, error: autosave.state === 'conflict' ? 'conflict' : 'offline' }
    try {
      await publishCatalogueDraft(ctx, 'project-a', 'item', { id: ID, rev: autosave.rev, mode }, f.deps)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: (e as { code?: string }).code ?? 'failed' }
    }
  }
  return { autosave, states, publish }
}

/** What the page renders (the getCatalogueDoc snapshot fields the key uses). */
const snapshotOf = (f: Fake) => {
  const draft = f.store.get(`drafts.${ID}`)
  const live = f.store.get(ID)
  return { id: ID, rev: (draft?._rev as string | undefined) ?? '', live: live ? { rev: live._rev as string } : null }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('price edit, then category added, then Publish (Tom, 2026-11-03)', () => {
  it('never-published legacy food draft: published with the new price AND the added category, no conflict', async () => {
    const f = sanity([margherita(), optionList])
    const e = editor(f, { rev: 'r-staging' })
    e.autosave.set(priceSet(5.55))
    await wait(30)
    e.autosave.set(categorySet('typography'))
    await wait(30)
    const out = await e.publish()
    expect(e.states).not.toContain('conflict')
    expect(out).toEqual({ ok: true })
    const live = f.store.get(ID)!
    expect(live.formats).toEqual([expect.objectContaining({ _key: 'default', prices: [expect.objectContaining({ amount: 5.55 })] })])
    expect(live.primaryCategory).toBe('design')
    expect(live.additionalCategories).toEqual(['typography'])
    // Exactly one shape per document.
    expect(live).not.toHaveProperty('offers')
    expect(live).not.toHaveProperty('categories')
    expect(f.store.has(`drafts.${ID}`)).toBe(false)
  })

  it('a category created inline ("Add category") between the two saves is assigned and published', async () => {
    const f = sanity([margherita(), optionList])
    const e = editor(f, { rev: 'r-staging' })
    e.autosave.set(priceSet(5.55))
    await wait(30)
    f.addCategory('pizza')
    e.autosave.set(categorySet('pizza'))
    expect(await e.publish()).toEqual({ ok: true })
    expect(f.store.get(ID)!.additionalCategories).toEqual(['pizza'])
  })

  it('the re-render after a save (revalidatePath of inline creation, session cookie refresh) keeps the same editor; a publish starts it over', async () => {
    const f = sanity([margherita(), optionList])
    const before = catalogueEditorKey(snapshotOf(f))
    const e = editor(f, { rev: 'r-staging' })
    e.autosave.set(priceSet(5.55))
    await e.autosave.flush()
    expect(snapshotOf(f).rev).not.toBe('r-staging')
    expect(catalogueEditorKey(snapshotOf(f))).toBe(before)
    expect(await e.publish()).toEqual({ ok: true })
    expect(catalogueEditorKey(snapshotOf(f))).not.toBe(before)
  })

  it('ROOT CAUSE: a remounted editor (second engine with the rendered revision, replaying the first one’s journal) races the first → "changed elsewhere", the category lost', async () => {
    const f = sanity([margherita(), optionList])
    const journal = createMemoryJournal()
    const a = editor(f, { rev: 'r-staging' }, journal)
    a.autosave.set(priceSet(5.55))
    // The page re-renders from what is stored now; with the old key (the draft revision) React remounts the editor:
    const rendered = snapshotOf(f)
    // the old editor's unmount flushes its queue …
    const flushing = a.autosave.flush().finally(() => a.autosave.dispose())
    // … while the new one starts with the rendered revision and replays the shared journal.
    const b = editor(f, { rev: rendered.rev }, journal)
    await b.autosave.replay()
    await flushing
    // The category, picked in the editor being unmounted, goes into a disposed engine.
    a.autosave.set(categorySet('typography'))
    await wait(40)
    expect(b.states).toContain('conflict')
    expect(await b.publish()).toEqual({ ok: false, error: 'conflict' })
    const draft = f.store.get(`drafts.${ID}`)!
    expect(draft.additionalCategories).toBeUndefined()
    expect(draft.formats).toEqual([expect.objectContaining({ prices: [expect.objectContaining({ amount: 5.55 })] })])
  })

  it('a genuine edit from another window is still detected: the next save and the publish report a conflict', async () => {
    const f = sanity([margherita(), optionList])
    const e = editor(f, { rev: 'r-staging' })
    e.autosave.set(priceSet(5.55))
    await e.autosave.flush()
    const other = editor(f, { rev: snapshotOf(f).rev })
    other.autosave.set({ 'name.en': 'Pizza Margherita DOP' })
    expect(await other.autosave.flush()).toBe(true)
    e.autosave.set(categorySet('typography'))
    await wait(30)
    expect(e.states).toContain('conflict')
    expect(await e.publish()).toEqual({ ok: false, error: 'conflict' })
    // …and a publish with the stale revision is refused by the server itself.
    await expect(publishCatalogueDraft(ctx, 'project-a', 'item', { id: ID, rev: e.autosave.rev, mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.store.has(ID)).toBe(false)
  })

  it('already-published legacy item: the first edit opens and converts the draft, the category is added, "Update" publishes both', async () => {
    const f = sanity([publishedLegacy(), optionList])
    const key = catalogueEditorKey(snapshotOf(f))
    const e = editor(f, { rev: '', liveRev: 'live-1' })
    e.autosave.set(priceSet(5.55))
    expect(await e.autosave.flush()).toBe(true)
    expect(f.store.has(`drafts.${ID}`)).toBe(true)
    // The draft now exists: the page's re-render keeps the same editor.
    expect(catalogueEditorKey(snapshotOf(f))).toBe(key)
    e.autosave.set(categorySet('typography'))
    expect(await e.publish('keep')).toEqual({ ok: true })
    expect(e.states).not.toContain('conflict')
    const live = f.store.get(ID)!
    expect(live.formats).toEqual([expect.objectContaining({ prices: [expect.objectContaining({ amount: 5.55 })] })])
    expect(live.primaryCategory).toBe('design')
    expect(live.additionalCategories).toEqual(['typography'])
    expect(live).not.toHaveProperty('offers')
    expect(live).not.toHaveProperty('categories')
  })

  it('a book: price, then category, then publish', async () => {
    const f = sanity([book()])
    const e = editor(f, { rev: 'r-staging' })
    e.autosave.set(priceSet(24))
    await wait(30)
    e.autosave.set(categorySet('typography'))
    expect(await e.publish()).toEqual({ ok: true })
    const live = f.store.get(ID)!
    expect(live.bookDetails).toMatchObject({ isbn: '9783721201451' })
    expect(live.formats).toEqual([expect.objectContaining({ prices: [expect.objectContaining({ amount: 24 })] })])
    expect(live.additionalCategories).toEqual(['typography'])
    expect(live).not.toHaveProperty('offers')
    expect(live).not.toHaveProperty('categories')
  })
})

describe('catalogueEditorKey', () => {
  it('ignores the draft revision; follows the published revision', () => {
    expect(catalogueEditorKey({ id: 'a', live: null })).toBe('a:')
    expect(catalogueEditorKey({ id: 'a', live: { rev: 'l1' } })).not.toBe(catalogueEditorKey({ id: 'a', live: { rev: 'l2' } }))
    expect(catalogueEditorKey({ id: 'a', live: null })).not.toBe(catalogueEditorKey({ id: 'a', live: { rev: 'l1' } }))
    expect(catalogueEditorKey({ id: 'a', live: null })).not.toBe(catalogueEditorKey({ id: 'b', live: null }))
  })

  it('every Catalogue editor page keys its editor with it (never with the draft revision)', () => {
    const root = path.resolve(__dirname, '../../../app/[locale]/(client)/[tenant]/catalogue')
    for (const page of ['[id]/page.tsx', 'collections/[id]/page.tsx', 'option-lists/[id]/page.tsx']) {
      const src = readFileSync(path.join(root, page), 'utf8')
      expect(src, page).toContain('key={catalogueEditorKey(snapshot)}')
      expect(src, page).not.toMatch(/key=\{snapshot\.rev/)
    }
  })
})
