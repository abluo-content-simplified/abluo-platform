/**
 * FAQ sets in the client dashboard (ADR-037). Every refusal happens BEFORE any
 * write; identity comes from the grant; links must target this project.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  createFaqSet,
  discardFaqSetDraft,
  duplicateFaqSet,
  FAQ_LIMITS,
  FaqSetError,
  getFaqSet,
  getFaqSetActivity,
  listFaqSets,
  openFaqSetForEdit,
  patchFaqSetDraft,
  publishFaqSetDraft,
  runFaqSetLifecycle,
  searchFaqLinkTargets,
} from '../faq-sets'
import { FAQ_DELETE_REFERRERS, FAQ_PAGE_REFERRERS, FAQ_POST_REFERRERS } from '../faq-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const S = 'set-1'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['faq.set.read', 'faq.set.write', 'faq.set.delete'],
  enabledModuleIds: ['faq'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['faq.set.read', 'faq.set.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['faq.set.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const para = (text: string, key = 'b1', extra: Record<string, unknown> = {}) => ({
  _type: 'block',
  _key: key,
  style: 'normal',
  markDefs: [],
  children: [{ _type: 'span', _key: `${key}s`, text, marks: [] }],
  ...extra,
})
const entry = (key: string, q: Record<string, string>, a: Record<string, unknown[]> = {}, extra: Record<string, unknown> = {}) => ({
  _key: key,
  _type: 'faqEntry',
  question: { _type: 'localizedString', ...q, ...(extra.qStatus ? { translationStatus: extra.qStatus } : {}) },
  answer: { _type: 'faqAnswerText', ...a },
})
const baseDocs = (): Docs => ({
  [S]: { _id: S, _type: 'faqSet', _rev: 'p1', _createdAt: '2026-10-01T00:00:00Z', projectSlug: 'hoffmann', internalName: 'Impianti', items: [entry('a', { it: 'Fa male?' }, { it: [para('No.')] })] },
  [`drafts.${S}`]: {
    _id: `drafts.${S}`,
    _type: 'faqSet',
    _rev: 'd1',
    _createdAt: '2026-10-02T00:00:00Z',
    projectSlug: 'hoffmann',
    internalName: 'Impianti',
    title: { _type: 'localizedString', it: 'Domande' },
    items: [
      entry('a', { it: 'Fa male?', de: 'Tut es weh?' }, { it: [para('No.')] }, { qStatus: { de: 'manual' } }),
      entry('b', { it: 'Quanto dura?' }, { it: [para('Un’ora.')], de: [para('Eine Stunde.')] }),
    ],
  },
  other: { _id: 'other', _type: 'faqSet', _rev: 'o1', projectSlug: 'livener', items: [] },
  notaset: { _id: 'notaset', _type: 'post', _rev: 'x1', projectSlug: 'hoffmann' },
})

type Opts = {
  docs?: Docs
  usage?: Array<{ _id: string; _type: string; title?: unknown; live?: boolean; refs: string[] }>
  pageRefs?: Array<{ _id: string; _type: string; label?: unknown }>
  postRefs?: Array<{ _id: string; _type: string; label?: unknown }>
  deleteRefs?: Array<{ _id: string; _type: string; label?: unknown }>
  linkTargets?: string[]
  setCount?: number
  projectCount?: number
  commitError?: unknown
}

function fake(opts: Opts = {}) {
  const docs = opts.docs ?? baseDocs()
  const writes: Array<[string, unknown]> = []
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
  const created: Array<Record<string, unknown>> = []
  const patch = vi.fn((id: string) => {
    const p = {
      ifRevisionId: (r: string) => (patchOps.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), p),
      set: (v: unknown) => (patchOps.push(['set', v]), p),
      unset: (v: unknown) => (patchOps.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['patch', id])
        return { _rev: 'd2' }
      }),
    }
    return p
  })
  const transaction = vi.fn(() => {
    const tx = {
      patch: (id: string, v: unknown) => (txOps.push(['patch', [id, v]]), tx),
      create: (d: unknown) => (txOps.push(['create', d]), tx),
      createOrReplace: (d: unknown) => (txOps.push(['createOrReplace', d]), tx),
      delete: (id: string) => (txOps.push(['delete', id]), tx),
      commit: vi.fn(async (o?: { transactionId?: string }) => {
        if (opts.commitError) throw opts.commitError
        writes.push(['transaction', o?.transactionId ?? ''])
        return {}
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return opts.projectCount ?? 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q.includes('count(*[_type == "faqSet"')) return opts.setCount ?? 3
    if (q === FAQ_PAGE_REFERRERS) return opts.pageRefs ?? []
    if (q === FAQ_POST_REFERRERS) return opts.postRefs ?? []
    if (q === FAQ_DELETE_REFERRERS) return opts.deleteRefs ?? []
    if (q.includes('references($ids)')) return (opts.usage ?? []).filter((u) => u.refs.some((r) => (p.ids as string[]).includes(r)))
    if (q.includes('_id in $ids && _type in $types')) return (p.ids as string[]).filter((id) => (opts.linkTargets ?? []).includes(id))
    if (q.includes('"entries"')) {
      return Object.values(docs)
        .filter((d) => d._type === 'faqSet' && d.projectSlug === p.projectSlug)
        .map((d) => ({
          _id: d._id,
          _createdAt: d._createdAt,
          _updatedAt: d._rev === 'd1' ? '2026-10-05T00:00:00Z' : '2026-10-03T00:00:00Z',
          internalName: d.internalName,
          archivedAt: d.archivedAt,
          count: (d.items as unknown[]).length,
          entries: (d.items as Array<{ question: unknown; answer: Record<string, unknown[]> }>).map((i) => ({
            q: i.question,
            a: { it: i.answer.it?.length ?? null, de: i.answer.de?.length ?? null },
          })),
        }))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (created.push(d), writes.push(['create', d._id]), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  const audit = vi.fn(async () => undefined)
  let n = 0
  return {
    client,
    writes,
    patchOps,
    txOps,
    created,
    audit,
    deps: {
      client: client as never,
      uuid: () => 'new-set-1',
      newKey: () => `k${++n}`,
      now: () => new Date('2026-10-19T10:00:00Z'),
      audit,
    },
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const calls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>, pid = 'project-a') => [
    () => createFaqSet(c, pid, { name: 'x' }, f.deps),
    () => openFaqSetForEdit(c, pid, { id: S }, f.deps),
    () => patchFaqSetDraft(c, pid, { id: S, rev: 'd1', set: { note: 'x' } }, f.deps),
    () => publishFaqSetDraft(c, pid, { id: S, rev: 'd1' }, f.deps),
    () => discardFaqSetDraft(c, pid, { id: S, rev: 'd1' }, f.deps),
    () => duplicateFaqSet(c, pid, { id: S, name: 'Copy' }, f.deps),
    () => runFaqSetLifecycle(c, pid, { id: S, op: 'archive' }, f.deps),
    () => searchFaqLinkTargets(c, pid, { locale: 'it' }, { fetch: vi.fn() as never }),
  ]
  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without the FAQ module', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of calls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it("another tenant's project is refused for reads and writes", async () => {
    const f = fake()
    for (const call of calls(ctx(grant()), f, 'project-b')) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    await expect(listFaqSets(ctx(grant()), 'project-b', f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getFaqSet(ctx(grant()), 'project-b', S, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getFaqSetActivity(ctx(grant()), 'project-b', { id: S }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })

  it('a viewer can read, list and see activity', async () => {
    const f = fake()
    const read = vi.fn(async () => [])
    await expect(listFaqSets(ctx(viewer()), 'project-a', f.deps)).resolves.toMatchObject({ sets: [{ id: S }] })
    await expect(getFaqSet(ctx(viewer()), 'project-a', S, f.deps)).resolves.toMatchObject({ id: S })
    await expect(getFaqSetActivity(ctx(viewer()), 'project-a', { id: S }, { ...f.deps, read })).resolves.toEqual([])
    expect(read).toHaveBeenCalledWith({ projectId: 'project-a', contentType: 'faqSet', contentIds: [S] })
  })

  it("another project's set, other types and unsafe ids are not_found", async () => {
    const f = fake()
    for (const id of ['other', 'notaset', 'drafts.x', '../x', 'a/b']) {
      await expect(getFaqSet(ctx(grant()), 'project-a', id, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(openFaqSetForEdit(ctx(grant()), 'project-a', { id }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(getFaqSetActivity(ctx(grant()), 'project-a', { id }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.writes).toEqual([])
  })

  it('refuses every write when the project slug is shared by two Sanity projects', async () => {
    const f = fake({ projectCount: 2 })
    await expect(patchFaqSetDraft(ctx(grant()), 'project-a', { id: S, rev: 'd1', set: { note: 'x' } }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(createFaqSet(ctx(grant()), 'project-a', { name: 'x' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.writes).toEqual([])
  })

  it('permanent delete needs faq.set.delete on top of write', async () => {
    const f = fake()
    await expect(runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'deletePermanently' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('an unknown lifecycle op is refused', async () => {
    const f = fake()
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: S, op: 'nuke' as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

// ── List / read ───────────────────────────────────────────────────────────────

describe('listFaqSets', () => {
  it('merges draft over published and describes each set', async () => {
    const f = fake({ usage: [{ _id: 'home', _type: 'page', title: { it: 'Home' }, refs: [S] }, { _id: 'post-1', _type: 'post', title: { it: 'Post' }, live: false, refs: [S] }] })
    const { sets, site } = await listFaqSets(ctx(viewer()), 'project-a', f.deps)
    expect(site).toEqual({ defaultLocale: 'it', languages: ['it', 'de'] })
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({
      id: S,
      name: 'Impianti',
      count: 2,
      firstQuestions: ['Fa male?', 'Quanto dura?'],
      // "a" has no German answer, "b" has no German question.
      missingLocales: ['de'],
      state: 'changes',
      hasDraft: true,
      isPublished: true,
      archivedAt: null,
      createdAt: '2026-10-01T00:00:00Z',
      usedIn: [
        { kind: 'page', id: 'home', title: 'Home', published: true },
        { kind: 'post', id: 'post-1', title: 'Post', published: false },
      ],
    })
    expect(sets[0].searchText).toContain('impianti')
    expect(sets[0].searchText).toContain('tut es weh?')
  })

  it('marks an archived set', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${S}`]
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    const { sets } = await listFaqSets(ctx(viewer()), 'project-a', fake({ docs }).deps)
    expect(sets[0]).toMatchObject({ state: 'archived', archivedAt: '2026-10-10T00:00:00Z', hasDraft: false, isPublished: true })
  })

  it("never returns another project's sets", async () => {
    const f = fake()
    const { sets } = await listFaqSets(ctx(viewer()), 'project-a', f.deps)
    expect(sets.map((s) => s.id)).toEqual([S])
  })
})

describe('getFaqSet', () => {
  it('returns the draft over the published version', async () => {
    const f = fake({ usage: [{ _id: 'home', _type: 'homePage', title: { it: 'Home' }, refs: [S] }] })
    const snap = await getFaqSet(ctx(viewer()), 'project-a', S, f.deps)
    expect(snap).toMatchObject({
      id: S,
      rev: 'd1',
      hasDraft: true,
      isPublished: true,
      state: 'changes',
      name: 'Impianti',
      note: '',
      title: { it: 'Domande' },
      live: { rev: 'p1' },
      usedIn: [{ kind: 'page', id: 'home', title: 'Home', published: true }],
      site: { defaultLocale: 'it', languages: ['it', 'de'] },
    })
    expect(snap.items.map((i) => i._key)).toEqual(['a', 'b'])
    expect(snap.items[0].question).toEqual({ it: 'Fa male?', de: 'Tut es weh?' })
    expect(Object.keys(snap.items[1].answer)).toEqual(['it', 'de'])
  })

  it('has an empty rev when only the published version exists', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${S}`]
    const snap = await getFaqSet(ctx(viewer()), 'project-a', S, fake({ docs }).deps)
    expect(snap).toMatchObject({ rev: '', hasDraft: false, state: 'published' })
  })
})

// ── Create / open / duplicate ─────────────────────────────────────────────────

describe('createFaqSet', () => {
  it('creates drafts.<uuid> with the project from the grant and audits "created"', async () => {
    const f = fake()
    await expect(createFaqSet(ctx(editor()), 'project-a', { name: '  Booking   &  cancellation ' }, f.deps)).resolves.toEqual({ id: 'new-set-1', rev: 'c1' })
    expect(f.created[0]).toMatchObject({ _id: 'drafts.new-set-1', _type: 'faqSet', projectSlug: 'hoffmann', internalName: 'Booking & cancellation', items: [] })
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'faqSet', contentId: 'new-set-1', action: 'created', outcome: 'ok' }))
  })

  it.each([[''], ['   '], [undefined], [42], ['x'.repeat(FAQ_LIMITS.name + 1)]])('refuses the name %j', async (name) => {
    const f = fake()
    await expect(createFaqSet(ctx(editor()), 'project-a', { name: name as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('stops at the cap', async () => {
    const f = fake({ setCount: FAQ_LIMITS.sets * 2 })
    await expect(createFaqSet(ctx(editor()), 'project-a', { name: 'x' }, f.deps)).rejects.toMatchObject({ code: 'too_large' })
  })
})

describe('openFaqSetForEdit', () => {
  it('returns the existing draft', async () => {
    const f = fake()
    await expect(openFaqSetForEdit(ctx(editor()), 'project-a', { id: S }, f.deps)).resolves.toEqual({ id: S, rev: 'd1', created: false })
    expect(f.writes).toEqual([])
  })

  it('copies the published set into a draft, without system fields', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${S}`]
    const f = fake({ docs })
    await expect(openFaqSetForEdit(ctx(editor()), 'project-a', { id: S }, f.deps)).resolves.toEqual({ id: S, rev: 'c1', created: true })
    expect(f.created[0]).toMatchObject({ _id: `drafts.${S}`, _type: 'faqSet', projectSlug: 'hoffmann', internalName: 'Impianti' })
    expect(f.created[0]).not.toHaveProperty('_rev')
  })

  it('refuses to open an archived set', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${S}`]
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    await expect(openFaqSetForEdit(ctx(editor()), 'project-a', { id: S }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'archived' })
  })
})

describe('duplicateFaqSet', () => {
  it('creates a new draft with fresh keys, title and note copied, nothing attached', async () => {
    const docs = baseDocs()
    docs[`drafts.${S}`].note = 'Keep short'
    const f = fake({ docs })
    await expect(duplicateFaqSet(ctx(editor()), 'project-a', { id: S, name: 'Copy of Impianti' }, f.deps)).resolves.toEqual({ id: 'new-set-1', rev: 'c1' })
    const doc = f.created[0] as { _id: string; internalName: string; note: string; title: unknown; items: Array<{ _key: string; question: unknown }>; projectSlug: string; archivedAt?: unknown }
    expect(doc).toMatchObject({ _id: 'drafts.new-set-1', projectSlug: 'hoffmann', internalName: 'Copy of Impianti', note: 'Keep short', title: { it: 'Domande' } })
    expect(doc.items.map((i) => i._key)).toEqual(['k1', 'k2'])
    expect(doc.items[0].question).toMatchObject({ it: 'Fa male?', de: 'Tut es weh?' })
    expect(doc.archivedAt).toBeUndefined()
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'new-set-1', action: 'created' }))
  })

  it("refuses another project's set and an empty name", async () => {
    const f = fake()
    await expect(duplicateFaqSet(ctx(editor()), 'project-a', { id: 'other', name: 'x' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(duplicateFaqSet(ctx(editor()), 'project-a', { id: S, name: ' ' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.created).toEqual([])
  })
})

// ── Patch ─────────────────────────────────────────────────────────────────────

const patch = (f: ReturnType<typeof fake>, set: Record<string, unknown>, rev = 'd1', c = ctx(editor())) =>
  patchFaqSetDraft(c, 'project-a', { id: S, rev, set }, f.deps)

describe('patchFaqSetDraft', () => {
  it('saves name, note and per-language titles, guarded by the revision', async () => {
    const f = fake()
    await expect(patch(f, { internalName: ' Nuovo ', note: 'Per gli editor', 'title.de': 'Fragen', 'title.it': '' })).resolves.toEqual({ rev: 'd2' })
    expect(f.patchOps).toEqual(
      expect.arrayContaining([
        ['ifRevisionId', 'd1'],
        ['setIfMissing', { title: { _type: 'localizedString' } }],
        ['set', { internalName: 'Nuovo', note: 'Per gli editor', 'title.de': 'Fragen' }],
        ['unset', ['title.it']],
      ])
    )
  })

  it('unsets an emptied note', async () => {
    const f = fake()
    await patch(f, { note: '  ' })
    expect(f.patchOps).toContainEqual(['unset', ['note']])
  })

  it.each([
    ['_id', 'x'],
    ['projectSlug', 'livener'],
    ['_type', 'post'],
    ['archivedAt', '2026-01-01'],
    ['items.0.question', 'x'],
    ['title', 'x'],
    ['title.it.x', 'x'],
    ['title.', 'x'],
  ])('refuses the field %s', async (path, value) => {
    const f = fake()
    await expect(patch(f, { [path]: value })).rejects.toMatchObject({ code: 'invalid_field' })
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('refuses a language the site does not have, a bad title, a too long note, an empty name', async () => {
    const f = fake()
    await expect(patch(f, { 'title.fr': 'x' })).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(patch(f, { 'title.it': 'x'.repeat(FAQ_LIMITS.title + 1) })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(patch(f, { 'title.it': 5 })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(patch(f, { note: 'x'.repeat(FAQ_LIMITS.note + 1) })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(patch(f, { internalName: '' })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('is a conflict when the revision is stale or missing, not_found without a draft', async () => {
    const f = fake()
    await expect(patch(f, { note: 'x' }, 'old')).rejects.toMatchObject({ code: 'conflict' })
    await expect(patch(f, { note: 'x' }, '')).rejects.toMatchObject({ code: 'conflict' })
    const docs = baseDocs()
    delete docs[`drafts.${S}`]
    await expect(patch(fake({ docs }), { note: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })

  it('maps a Sanity 409 to conflict and anything else to failed', async () => {
    await expect(patch(fake({ commitError: { statusCode: 409 } }), { note: 'x' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(patch(fake({ commitError: new Error('boom') }), { note: 'x' })).rejects.toMatchObject({ code: 'failed' })
  })

  it('refuses edits to an archived set', async () => {
    const docs = baseDocs()
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    await expect(patch(fake({ docs }), { note: 'x' })).rejects.toMatchObject({ code: 'archived' })
  })

  it('refuses a patch that is too large', async () => {
    const f = fake()
    await expect(patch(f, { note: 'x'.repeat(FAQ_LIMITS.patchBytes) })).rejects.toMatchObject({ code: 'too_large' })
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  describe('items', () => {
    const items = (...list: unknown[]) => ({ items: list })
    const saved = (f: ReturnType<typeof fake>) => (f.patchOps.find(([k, v]) => k === 'set' && (v as { items?: unknown }).items)![1] as { items: Array<Record<string, any>> }).items // eslint-disable-line @typescript-eslint/no-explicit-any

    it('rebuilds entries: type, safe keys, trimmed questions, sanitized answers', async () => {
      const f = fake()
      await patch(
        f,
        items(
          { _key: 'a', _type: 'evil', question: { it: '  Fa   male?  ', de: '', _type: 'x' }, answer: { it: [para('No.', 'p1')], de: [] }, projectSlug: 'livener' },
          { _key: 'bad key!', question: { it: 'Due' } },
          { _key: 'a', question: { it: 'Tre' } },
          { question: { it: 'Quattro' } }
        )
      )
      const out = saved(f)
      expect(out.map((i) => i._key)).toEqual(['a', 'k1', 'k2', 'k3'])
      expect(out.every((i) => i._type === 'faqEntry')).toBe(true)
      expect(out[0]).toEqual({
        _key: 'a',
        _type: 'faqEntry',
        // translationStatus of the stored question is kept untouched.
        question: { _type: 'localizedString', it: 'Fa male?', translationStatus: { de: 'manual' } },
        answer: { _type: 'faqAnswerText', it: [para('No.', 'p1')] },
      })
      expect(out[1].answer).toEqual({ _type: 'faqAnswerText' })
    })

    it('accepts an empty list', async () => {
      const f = fake()
      await patch(f, { items: [] })
      expect(saved(f)).toEqual([])
    })

    it('refuses too many entries, non-lists, non-objects, long questions and non-text', async () => {
      const f = fake()
      await expect(patch(f, { items: Array.from({ length: FAQ_LIMITS.items + 1 }, () => ({})) })).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, { items: 'x' })).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, items(null))).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, items({ question: { it: 'x'.repeat(FAQ_LIMITS.question + 1) } }))).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, items({ question: { it: 5 } }))).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, items({ question: 'x' }))).rejects.toMatchObject({ code: 'invalid_value' })
      expect(f.writes).toEqual([])
    })

    it('refuses languages the site does not have, but keeps languages already stored', async () => {
      const f = fake()
      await expect(patch(f, items({ _key: 'a', question: { fr: 'Non' } }))).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(patch(f, items({ _key: 'a', question: { it: 'ok' }, answer: { fr: [para('x')] } }))).rejects.toMatchObject({ code: 'invalid_value' })
      const docs = baseDocs()
      ;(docs[`drafts.${S}`].items as Array<Record<string, any>>)[0].question.fr = 'Fait mal ?' // eslint-disable-line @typescript-eslint/no-explicit-any
      const g = fake({ docs })
      await patch(g, items({ _key: 'a', question: { it: 'Fa male?', fr: 'Fait mal ?' } }))
      expect(saved(g)[0].question.fr).toBe('Fait mal ?')
    })

    it('refuses headings, images and unsafe links in answers', async () => {
      const f = fake()
      const withAnswer = (blocks: unknown[]) => patch(f, items({ _key: 'a', question: { it: 'q' }, answer: { it: blocks } }))
      await expect(withAnswer([para('x', 'p', { style: 'h2' })])).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(withAnswer([{ _type: 'image', _key: 'i' }])).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(
        withAnswer([para('x', 'p', { markDefs: [{ _type: 'link', _key: 'l', href: 'javascript:alert(1)' }], children: [{ _type: 'span', _key: 'c', text: 'x', marks: ['l'] }] })])
      ).rejects.toMatchObject({ code: 'invalid_value' })
      expect(f.writes).toEqual([])
    })

    const linked = (ref: string) =>
      items({
        _key: 'a',
        question: { it: 'q' },
        answer: {
          it: [para('See', 'p', { markDefs: [{ _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: ref } }], children: [{ _type: 'span', _key: 'c', text: 'See', marks: ['l'] }] })],
        },
      })

    it('checks a NEW internal link against this project’s link targets, once', async () => {
      const f = fake({ linkTargets: ['page-1'] })
      await patch(f, linked('page-1'))
      const check = f.client.fetch.mock.calls.filter(([q]) => String(q).includes('_id in $ids && _type in $types'))
      expect(check).toHaveLength(1)
      expect(check[0][1]).toMatchObject({ ids: ['page-1'], projectSlug: 'hoffmann' })
      expect((check[0][1] as { types: string[] }).types).toEqual(expect.arrayContaining(['page', 'post', 'catalogueItem', 'catalogueCollection']))
      expect(saved(f)[0].answer.it[0].markDefs[0].internal).toEqual({ _type: 'reference', _ref: 'page-1', _weak: true })
    })

    it('refuses a new link to a document that is not a target of this project', async () => {
      const f = fake({ linkTargets: [] })
      await expect(patch(f, linked('page-of-livener'))).rejects.toMatchObject({ code: 'invalid_value' })
      expect(f.writes).toEqual([])
    })

    it('leaves a link that is already stored alone (its target may be gone)', async () => {
      const docs = baseDocs()
      const stored = linked('gone').items[0] as { answer: { it: unknown[] } }
      ;(docs[`drafts.${S}`].items as unknown[])[0] = { ...entry('a', { it: 'q' }), answer: { _type: 'faqAnswerText', it: stored.answer.it.map((b) => ({ ...(b as object), markDefs: [{ _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: 'gone', _weak: true } }] })) } }
      const f = fake({ docs, linkTargets: [] })
      await patch(f, linked('gone'))
      expect(f.client.fetch.mock.calls.some(([q]) => String(q).includes('_id in $ids && _type in $types'))).toBe(false)
      expect(f.writes).toEqual([['patch', `drafts.${S}`]])
    })

    it('keeps the stored answer translationStatus', async () => {
      const docs = baseDocs()
      ;(docs[`drafts.${S}`].items as Array<Record<string, any>>)[0].answer.translationStatus = { de: 'auto' } // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = fake({ docs })
      await patch(f, items({ _key: 'a', question: { it: 'q' }, answer: { it: [para('x')] } }))
      expect(saved(f)[0].answer.translationStatus).toEqual({ de: 'auto' })
    })
  })
})

// ── Publish / discard ─────────────────────────────────────────────────────────

describe('publishFaqSetDraft', () => {
  it('publishes in one guarded transaction and audits it', async () => {
    const f = fake()
    const out = await publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, f.deps)
    expect(out.rev).toMatch(/^abluo-dash-/)
    expect(f.txOps).toEqual([
      ['patch', [`drafts.${S}`, { ifRevisionID: 'd1', unset: ['_publishGuard'] }]],
      ['patch', [S, { ifRevisionID: 'p1', unset: ['_publishGuard'] }]],
      ['createOrReplace', expect.objectContaining({ _id: S, _type: 'faqSet', projectSlug: 'hoffmann', internalName: 'Impianti' })],
      ['delete', `drafts.${S}`],
    ])
    expect(f.writes).toEqual([['transaction', out.rev]])
    // a content edit of a set that is already live is not a lifecycle event: no row.
    expect(f.audit).not.toHaveBeenCalled()
  })

  it('creates the published set the first time and audits "published"', async () => {
    const docs = baseDocs()
    delete docs[S]
    const f = fake({ docs })
    await publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, f.deps)
    expect(f.txOps.map(([k]) => k)).toEqual(['patch', 'create', 'delete'])
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'faqSet', contentId: S, action: 'published' }))
  })

  it('is a conflict on a stale revision, refused when archived, not_found without a draft', async () => {
    const f = fake()
    await expect(publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'old' }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: '' }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    const docs = baseDocs()
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    await expect(publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'archived' })
    const none = baseDocs()
    delete none[`drafts.${S}`]
    await expect(publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, fake({ docs: none }).deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })
})

describe('discardFaqSetDraft', () => {
  it('deletes the draft of a published set', async () => {
    const f = fake()
    await discardFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, f.deps)
    expect(f.txOps).toEqual([['patch', [`drafts.${S}`, { ifRevisionID: 'd1', unset: ['_lifecycleGuard'] }]], ['delete', `drafts.${S}`]])
  })

  it('refuses a never-published set and a stale revision', async () => {
    const docs = baseDocs()
    delete docs[S]
    await expect(discardFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    const f = fake()
    await expect(discardFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: 'x' }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.writes).toEqual([])
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('runFaqSetLifecycle', () => {
  it('archives a set no public content uses, and returns the draft’s new revision', async () => {
    const f = fake()
    const out = await runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'archive' }, f.deps)
    expect(out.rev).toMatch(/^abluo-dash-/)
    expect(f.txOps.map(([k, v]) => [k, (v as [string])[0]])).toEqual([['patch', S], ['patch', `drafts.${S}`]])
    expect((f.txOps[0][1] as [string, { set: Record<string, unknown>; ifRevisionID: string }])[1]).toMatchObject({ ifRevisionID: 'p1', set: { archivedAt: '2026-10-19T10:00:00.000Z', archivedBy: 'u1' } })
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'archived', contentType: 'faqSet' }))
  })

  it('refuses to archive while a public page or post shows it, and says where', async () => {
    const f = fake({
      pageRefs: [{ _id: 'home', _type: 'page', label: { it: 'Home' } }],
      postRefs: [{ _id: 'post-1', _type: 'post', label: { it: 'Post' } }],
      usage: [
        { _id: 'home', _type: 'page', title: { it: 'Home' }, refs: [S] },
        { _id: 'post-1', _type: 'post', title: { it: 'Post' }, refs: [S] },
        { _id: 'drafts.post-2', _type: 'post', title: { it: 'Bozza' }, refs: [S] },
      ],
    })
    const error = await runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'archive' }, f.deps).catch((e) => e)
    expect(error).toBeInstanceOf(FaqSetError)
    expect(error).toMatchObject({
      code: 'in_use',
      detail: {
        usedIn: [
          { kind: 'page', id: 'home', title: 'Home', published: true },
          { kind: 'post', id: 'post-1', title: 'Post', published: true },
        ],
      },
    })
    expect(f.writes).toEqual([])
  })

  it('restores an archived set', async () => {
    const docs = baseDocs()
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    docs[`drafts.${S}`].archivedAt = '2026-10-10T00:00:00Z'
    const f = fake({ docs })
    await runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'restore' }, f.deps)
    expect((f.txOps[0][1] as [string, { unset: string[] }])[1].unset).toEqual(expect.arrayContaining(['archivedAt', 'archivedBy']))
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'restored' }))
  })

  it('restoring puts the set back online: expiresAt (set by archive) is removed on both versions', async () => {
    const docs = baseDocs()
    for (const id of [S, `drafts.${S}`]) Object.assign(docs[id], { archivedAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z' })
    const f = fake({ docs })
    await runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'restore' }, f.deps)
    const unsets = f.txOps.filter((o) => o[0] === 'patch').map((o) => o[1] as [string, { unset?: string[] }])
    expect(unsets).toEqual(expect.arrayContaining([[S, { unset: ['expiresAt'] }], [`drafts.${S}`, { unset: ['expiresAt'] }]]))
  })

  it('publishing never copies lifecycle window fields from the draft', async () => {
    const docs = baseDocs()
    Object.assign(docs[`drafts.${S}`], { expiresAt: '2026-10-10T00:00:00Z', publishedAt: '2026-10-01T00:00:00Z' })
    const f = fake({ docs })
    await publishFaqSetDraft(ctx(editor()), 'project-a', { id: S, rev: docs[`drafts.${S}`]._rev as string }, f.deps)
    const written = f.txOps.find((o) => o[0] === 'createOrReplace' || o[0] === 'create')![1] as Record<string, unknown>
    expect(written.expiresAt).toBeUndefined()
    expect(written.publishedAt).toBeUndefined()
  })

  it('deletes a never-published draft with write permission only', async () => {
    const docs = baseDocs()
    delete docs[S]
    const f = fake({ docs })
    await expect(runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'deleteDraft' }, f.deps)).resolves.toEqual({ rev: null })
    expect(f.txOps.at(-1)).toEqual(['delete', `drafts.${S}`])
  })

  it('refuses to delete a draft that is still referenced (any reference), naming it', async () => {
    const docs = baseDocs()
    delete docs[S]
    const f = fake({ docs, deleteRefs: [{ _id: 'drafts.post-9', _type: 'post', label: { it: 'Bozza' } }], usage: [{ _id: 'drafts.post-9', _type: 'post', title: { it: 'Bozza' }, refs: [S] }] })
    await expect(runFaqSetLifecycle(ctx(editor()), 'project-a', { id: S, op: 'deleteDraft' }, f.deps)).rejects.toMatchObject({
      code: 'in_use',
      detail: { usedIn: [{ kind: 'post', id: 'post-9', title: 'Bozza', published: false }] },
    })
    expect(f.writes).toEqual([])
  })

  it('does not delete a published set directly (archive first)', async () => {
    const f = fake()
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: S, op: 'deleteDraft' }, f.deps)).rejects.toMatchObject({ code: 'archive_first' })
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: S, op: 'deletePermanently' }, f.deps)).rejects.toMatchObject({ code: 'archive_first' })
    expect(f.writes).toEqual([])
  })

  it('deletes an archived set permanently when nothing references it', async () => {
    const docs = baseDocs()
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    const f = fake({ docs })
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: S, op: 'deletePermanently' }, f.deps)).resolves.toEqual({ rev: null })
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, id]) => id)).toEqual([S, `drafts.${S}`])
  })

  it('refuses a permanent delete while anything references the set', async () => {
    const docs = baseDocs()
    docs[S].archivedAt = '2026-10-10T00:00:00Z'
    const f = fake({ docs, deleteRefs: [{ _id: 'post-1', _type: 'post', label: { it: 'Post' } }] })
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: S, op: 'deletePermanently' }, f.deps)).rejects.toMatchObject({ code: 'in_use' })
    expect(f.writes).toEqual([])
  })

  it("another project's set is not_found", async () => {
    const f = fake()
    await expect(runFaqSetLifecycle(ctx(grant()), 'project-a', { id: 'other', op: 'archive' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
  })
})

// ── Link search ───────────────────────────────────────────────────────────────

describe('searchFaqLinkTargets', () => {
  it('searches with faq.set.write, all body link types, and computes catalogue paths from the installation segment', async () => {
    const fetch = vi.fn(async () => [
      { _id: 'pg', _type: 'page', projectSlug: 'hoffmann', title: 'Chi sono', slug: 'chi-sono' },
      { _id: 'it1', _type: 'catalogueItem', projectSlug: 'hoffmann', title: 'Seduta', slug: 'seduta', hasPage: true, segment: 'servizi' },
      { _id: 'it2', _type: 'catalogueItem', projectSlug: 'hoffmann', title: 'No module', slug: 'x', hasPage: true, segment: null },
    ])
    const out = await searchFaqLinkTargets(ctx(editor()), 'project-a', { locale: 'it', query: 'se' }, { fetch: fetch as never })
    expect(out).toEqual([
      { id: 'pg', type: 'page', title: 'Chi sono', path: 'chi-sono' },
      { id: 'it1', type: 'catalogueItem', title: 'Seduta', path: 'servizi/seduta' },
    ])
    const params = (fetch.mock.calls[0] as unknown as [string, { types: string[]; projectSlug: string }])[1]
    expect(params.types).toEqual(['page', 'post', 'newsArticle', 'event', 'catalogueItem', 'catalogueCollection'])
    expect(params.projectSlug).toBe('hoffmann')
  })

  it('needs faq.set.write, not blog.post.write', async () => {
    const fetch = vi.fn()
    const blogOnly = grant({ enabledModuleIds: ['blog', 'faq'], permissions: ['blog.post.write', 'faq.set.read'] })
    await expect(searchFaqLinkTargets(ctx(blogOnly), 'project-a', { locale: 'it' }, { fetch: fetch as never })).rejects.toThrow(TenantAuthorizationError)
    expect(fetch).not.toHaveBeenCalled()
  })
})
