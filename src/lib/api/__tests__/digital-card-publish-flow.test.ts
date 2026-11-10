/**
 * Digital Cards — publish ↔ autosave, end to end at API level (Tom's report
 * 2026-11-09, Claudia Hoffmann's site card): "I switched the language to DE,
 * edited, clicked Publish → 'Couldn't save: this was changed somewhere else'."
 *
 * A stateful fake Content Lake (real revisions; ifRevisionId / ifRevisionID →
 * 409; publish = one transaction that deletes the draft) runs the REAL
 * saveDigitalCardDraft / openDigitalCardForEdit / publishDigitalCardDraft /
 * getDigitalCard behind the REAL autosave engine, with the editor's REAL send
 * (openThenSave) and its publish step (autosave.exclusive: flush → publish →
 * read back → continue from the revision read).
 *
 * The card is Hoffmann's, with her real shapes: languages it + de, a single
 * `siteConfig.location` (no `locations[]`), no published social profiles, two
 * page links (one labelled only in DE, one with no label).
 *
 * ROOT CAUSE: after a publish the engine still held the revision of the draft
 * that publishing had deleted. The next change opened a new draft, but when
 * the save right after the open did not go through (a refused value, a server
 * hiccup, a dropped connection), the editor's send reported the failure
 * WITHOUT the revision it had just opened; the draft was now marked open, so
 * the retry went out with the dead draft's revision → the revision guard
 * refused it as "changed elsewhere", and Publish showed it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { getDigitalCard, openDigitalCardForEdit, publishDigitalCardDraft, saveDigitalCardDraft } from '../digital-cards'
import { createAutosave, type SendResult } from '@/lib/client/autosave/engine'
import { createMemoryJournal } from '@/lib/client/autosave/journal'
import { openThenSave } from '@/lib/client/autosave/open-then-save'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const CARD = '4c5cb0ae-b8dd-4105-b503-a2b85dcb0a23'
const grant: any = { projectId: 'p', projectSlug: asSupabaseProjectSlug('hoffmann'), membershipId: 'm', role: 'owner', permissions: ['digital-cards.read', 'digital-cards.write'], enabledModuleIds: ['digital-cards'] }
const ctx: any = { userId: 'u', platformRole: 'tenant_user', projects: [grant] }

/** Hoffmann's published Website Settings as stored (2026-11-09): one `location`, no `locations[]`, no socialLinks. */
const HOFFMANN_SITE = {
  config: {
    siteName: 'Dott.ssa Claudia Hoffmann',
    defaultLocale: 'it',
    supportedLocales: ['it', 'de'],
    location: { _type: 'businessLocation', city: 'Varese', country: 'Italia', postalCode: '21100', state: 'VA', street: 'Via Amendola 11' },
    locations: null,
    socialLinks: null,
  },
  project: { customDomain: 'ch-psicoterapeuta.com' },
  // drafts.hoffmann-site-config: Tom added LinkedIn + Facebook in Studio but has not published Website Settings.
  draftSocials: [
    { platform: 'linkedin', url: 'https://it.linkedin.com/in/claudia-hoffmann-psicoterapeuta' },
    { platform: 'facebook', url: 'https://www.facebook.com/claudiahoffmannpsicologapsicoterapeuta/' },
  ],
}

function setPath(doc: any, path: string, v: unknown) {
  const parts = path.split('.')
  let o = doc
  for (const p of parts.slice(0, -1)) o = o[p] ??= {}
  o[parts.at(-1)!] = v
}
function unsetPath(doc: any, path: string) {
  const parts = path.split('.')
  let o = doc
  for (const p of parts.slice(0, -1)) {
    o = o?.[p]
    if (!o) return
  }
  delete o[parts.at(-1)!]
}

function lake() {
  const published = {
    _id: CARD,
    _type: 'digitalCard',
    _rev: 'p0',
    projectSlug: 'hoffmann',
    kind: 'site',
    publicId: '11111111-1111-4111-8111-111111111111',
    description: { _type: 'localizedText', it: 'Sono Claudia Hoffmann, psicoterapeuta a Varese.' },
    links: [
      { _key: 'cbfdf6bf94e1', _type: 'digitalCardLink', kind: 'page', hidden: false, primary: false, page: { _type: 'reference', _ref: 'hoffmann-page-home', _weak: true } },
      { _key: 'b6791e1598d8', _type: 'digitalCardLink', kind: 'page', hidden: false, primary: false, page: { _type: 'reference', _ref: 'hoffmann-page-contatti', _weak: true } },
    ],
    show: { description: true },
  }
  const docs: Record<string, any> = { [CARD]: published }
  let n = 0
  let failNextSave = false
  const client: any = {
    getDocument: async (id: string) => (docs[id] ? structuredClone(docs[id]) : undefined),
    create: async (d: any) => {
      if (docs[d._id]) throw Object.assign(new Error('exists'), { statusCode: 409 })
      docs[d._id] = { ...structuredClone(d), _rev: `rev${++n}` }
      return structuredClone(docs[d._id])
    },
    patch: (id: string) => {
      const ops: Array<[string, any]> = []
      const p: any = {
        ifRevisionId: (r: string) => (ops.push(['if', r]), p),
        setIfMissing: (v: any) => (ops.push(['setIfMissing', v]), p),
        set: (v: any) => (ops.push(['set', v]), p),
        unset: (v: any) => (ops.push(['unset', v]), p),
        commit: async () => {
          if (failNextSave) {
            failNextSave = false
            throw Object.assign(new Error('upstream timeout'), { statusCode: 503 })
          }
          const doc = docs[id]
          if (!doc) throw Object.assign(new Error('missing'), { statusCode: 404 })
          for (const [k, v] of ops) if (k === 'if' && doc._rev !== v) throw Object.assign(new Error('rev mismatch'), { statusCode: 409 })
          for (const [k, v] of ops) if (k === 'setIfMissing') for (const [path, val] of Object.entries(v)) if (doc[path] === undefined) doc[path] = val
          for (const [k, v] of ops) if (k === 'set') for (const [path, val] of Object.entries(v)) setPath(doc, path, structuredClone(val))
          for (const [k, v] of ops) if (k === 'unset') for (const path of v) unsetPath(doc, path)
          doc._rev = `rev${++n}`
          return structuredClone(doc)
        },
      }
      return p
    },
    transaction: () => {
      const ops: Array<[string, any]> = []
      const tx: any = {
        patch: (id: string, v: any) => (ops.push(['patch', [id, v]]), tx),
        create: (d: any) => (ops.push(['create', d]), tx),
        createOrReplace: (d: any) => (ops.push(['createOrReplace', d]), tx),
        delete: (id: string) => (ops.push(['delete', id]), tx),
        commit: async (o?: { transactionId?: string }) => {
          for (const [k, v] of ops) if (k === 'patch' && docs[v[0]]?._rev !== v[1].ifRevisionID) throw Object.assign(new Error('rev mismatch'), { statusCode: 409 })
          const rev = o?.transactionId ?? `tx${++n}`
          for (const [k, v] of ops) {
            if (k === 'create' || k === 'createOrReplace') docs[v._id] = { ...structuredClone(v), _rev: rev }
            if (k === 'delete') delete docs[v]
          }
          return {}
        },
      }
      return tx
    },
    fetch: async (q: string, p: Record<string, any> = {}) => {
      if (q.includes('count(*[_type == "project"')) return 1
      if (q.includes('"config": *[_type == "siteConfig"')) return HOFFMANN_SITE
      if (q.includes('_type == "digitalCard"') && q.includes('order(_updatedAt desc)')) return Object.values(docs)
      if (q.includes('_type == "page"') && q.includes('_id in $ids]._id')) return (p.ids as string[]).filter((i) => i.startsWith('hoffmann-page-'))
      if (q.includes('_type in $types') && q.includes('_id in $ids]._id')) return (p.ids as string[]).filter((i) => i.startsWith('hoffmann-page-'))
      if (q.includes('_type == "page"')) return [{ _id: 'hoffmann-page-home', title: 'Home' }, { _id: 'hoffmann-page-contatti', title: 'Contatti' }]
      if (q.includes('_type == "person"')) return []
      return null
    },
  }
  return { docs, client, failNextSave: () => (failNextSave = true) }
}

/** A copy of the editor's send BEFORE the fix: a failed save after opening the draft lost the opened revision. */
function oldSend(open: () => Promise<any>, save: (rev: string, set: any) => Promise<any>, draft: { has: boolean }) {
  return async (input: { rev: string; set: Record<string, unknown> }): Promise<SendResult> => {
    let rev = input.rev
    if (!draft.has || !rev) {
      const o = await open()
      if (!o.ok) return { ok: false, error: o.error }
      rev = o.rev
      draft.has = true
    }
    const r = await save(rev, input.set)
    return r.ok ? { ok: true, rev: r.rev } : { ok: false, error: r.error }
  }
}

const wrap = async <T,>(fn: () => Promise<T>) => {
  try {
    return { ok: true as const, ...(await fn()) }
  } catch (e: any) {
    return { ok: false as const, error: e.code ?? 'failed' }
  }
}

async function editor(l: ReturnType<typeof lake>, opts: { legacy?: boolean } = {}) {
  const deps = { client: l.client, audit: vi.fn(async () => undefined) } as any
  const snap = await getDigitalCard(ctx, 'p', CARD, deps)
  const draft = { has: snap.hasDraft }
  const refusals: string[] = []
  const open = () => wrap(() => openDigitalCardForEdit(ctx, 'p', { id: CARD }, deps))
  const save = async (rev: string, set: any) => {
    const r = await wrap(() => saveDigitalCardDraft(ctx, 'p', { id: CARD, rev, set }, deps))
    if (!r.ok) refusals.push(r.error)
    return r
  }
  const send = opts.legacy
    ? oldSend(open, save, draft)
    : (input: { rev: string; set: Record<string, unknown> }) =>
        openThenSave(input, { hasDraft: () => draft.has, markDraft: () => (draft.has = true), open, save })
  const engine = createAutosave({ draftId: `digital-card:${CARD}`, rev: snap.rev, send, storage: createMemoryJournal(), debounceMs: 0, retryDelaysMs: [0] })
  const type = async (set: Record<string, unknown>) => {
    engine.set(set)
    await engine.flush()
  }
  /** The editor's Publish (serverStep): flush → publish → read back, no autosave in between. */
  const publish = async (during?: () => void) => {
    const out = await engine.exclusive<any>(async (rev) => {
      const r = await wrap(() => publishDigitalCardDraft(ctx, 'p', { id: CARD, rev }, deps))
      during?.()
      if (!r.ok) return { value: r }
      const s = await getDigitalCard(ctx, 'p', CARD, deps)
      draft.has = s.hasDraft
      return { value: r, rev: s.rev }
    })
    return out
  }
  /** The OLD Publish: flush, publish, forget the draft, keep the engine's revision (getDigitalCard's '' was never adopted). */
  const legacyPublish = async () => {
    await engine.flush()
    const r = await wrap(() => publishDigitalCardDraft(ctx, 'p', { id: CARD, rev: engine.rev }, deps))
    draft.has = false
    await engine.discard()
    // The old adoptRead ignored the read's empty revision (no draft): the engine kept the deleted draft's.
    expect((await getDigitalCard(ctx, 'p', CARD, deps)).rev).toBe('')
    return r
  }
  return { engine, refusals, type, publish, legacyPublish, deps, draft }
}

describe('Hoffmann: edit IT, publish, switch to DE, edit, publish — one window', () => {
  it('reproduces the report with the old editor: a hiccup on the first save after a publish → "edited elsewhere"', async () => {
    const l = lake()
    const ed = await editor(l, { legacy: true })
    await ed.type({ 'description.it': 'Sono Claudia Hoffmann, psicoterapeuta a Varese. Da oltre 25 anni…' })
    expect((await ed.legacyPublish()).ok).toBe(true)
    expect(ed.engine.rev).not.toBe('') // the deleted draft's revision stays in the engine
    l.failNextSave()
    await ed.type({ 'description.de': 'Ich bin Claudia Hoffmann, Psychotherapeutin in Varese.' })
    await ed.engine.flush() // the retry
    expect(ed.refusals).toEqual(['failed', 'conflict'])
    expect(ed.engine.state).toBe('conflict')
  })

  it('fixed: the same sequence saves and publishes, never "edited elsewhere"', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Sono Claudia Hoffmann, psicoterapeuta a Varese. Da oltre 25 anni…' })
    const first = await ed.publish()
    expect(first.ok && first.value.ok).toBe(true)
    expect(ed.engine.rev).toBe('') // no draft any more: the next change opens one
    expect(l.docs[`drafts.${CARD}`]).toBeUndefined()

    l.failNextSave()
    await ed.type({ 'description.de': 'Ich bin Claudia Hoffmann, Psychotherapeutin in Varese.' })
    await ed.engine.flush() // the retry, against the draft just opened
    await ed.type({ links: [{ key: 'cbfdf6bf94e1', kind: 'page', label: { de: 'Homepage' }, description: {}, url: '', page: 'hoffmann-page-home', file: null, value: '', hidden: false, primary: false }, { key: 'b6791e1598d8', kind: 'page', label: {}, description: {}, url: '', page: 'hoffmann-page-contatti', file: null, value: '', hidden: false, primary: false }] })
    expect(ed.refusals).toEqual(['failed'])
    expect(ed.engine.state).toBe('saved')

    const second = await ed.publish()
    expect(second.ok && second.value.ok).toBe(true)
    expect(l.docs[CARD].description).toMatchObject({ it: expect.stringContaining('Varese'), de: expect.stringContaining('Psychotherapeutin') })
    expect(l.docs[CARD].links[0].label).toMatchObject({ de: 'Homepage' })
    expect(l.docs[`drafts.${CARD}`]).toBeUndefined()
  })

  it('a value refused on the first save after a publish does not turn the rest into "edited elsewhere"', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Ciao' })
    await ed.publish()
    // One batch: the DE text and a link to a page that is not on the site (refused) → split, one path at a time.
    await ed.type({ 'description.de': 'Hallo', links: [{ key: 'x1', kind: 'page', label: {}, description: {}, url: '', page: 'other-site-page', file: null, value: '', hidden: false, primary: false }] })
    expect(ed.refusals).not.toContain('conflict')
    expect(ed.engine.rejected).toEqual(['links'])
    expect(l.docs[`drafts.${CARD}`].description.de).toBe('Hallo')
  })

  it('typing while Publish runs: the text is kept and saved to a NEW draft (not dropped, not refused)', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Ciao' })
    const out = await ed.publish(() => ed.engine.set({ 'description.de': 'Hallo, während veröffentlicht wird' }))
    expect(out.ok && out.value.ok).toBe(true)
    expect(ed.engine.busy).toBe(true) // waited while publishing…
    await ed.engine.flush() // …and goes out right after
    expect(ed.refusals).toEqual([])
    expect(l.docs[CARD].description.de).toBeUndefined() // not in what was published
    expect(l.docs[`drafts.${CARD}`].description.de).toBe('Hallo, während veröffentlicht wird')
  })

  it('a second Publish right after the first is "nothing to publish", never a conflict', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Ciao' })
    await ed.publish()
    const again = await ed.publish()
    expect(again.ok).toBe(true)
    expect(again.ok && !again.value.ok && again.value.error).toBe('conflict') // rev '' → "Missing revision." — the button is disabled (no draft) in the editor
    expect(ed.engine.state).not.toBe('conflict')
  })

  it('the revision guard still holds: another window\'s save in between IS "edited elsewhere"', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Mia' })
    const other = await editor(l)
    await other.type({ 'description.it': 'Altra finestra' })
    await ed.type({ 'description.it': 'Mia, di nuovo' })
    expect(ed.refusals).toEqual(['conflict'])
    expect(ed.engine.state).toBe('conflict')
    expect(l.docs[`drafts.${CARD}`].description.it).toBe('Altra finestra')
  })
})

describe('Hoffmann: what the editor offers with her real Website Settings', () => {
  it('the single `location` is the card’s one address; the Studio-only socials are not offered, but flagged', async () => {
    const l = lake()
    const deps = { client: l.client } as any
    const snap = await getDigitalCard(ctx, 'p', CARD, deps)
    expect(snap.availability.locations).toEqual([{ key: 'location', label: 'Varese', detail: 'Via Amendola 11, 21100 Varese VA' }])
    expect((snap.show as any).locations).toEqual(['location']) // on by default
    expect(snap.availability.socials).toEqual([]) // what the website shows (published)
    expect(snap.availability.socialsPendingInStudio).toBe(true)
  })

  it('the address switch saves', async () => {
    const l = lake()
    const ed = await editor(l)
    await ed.type({ 'show.locations': [] })
    expect(ed.refusals).toEqual([])
    expect(l.docs[`drafts.${CARD}`].show.locations).toEqual([])
  })
})
