/**
 * Digital Cards editor ↔ server, end to end at API level (Tom's report
 * 2026-11-09): "I pasted the Italian text, then the German one — the German
 * field was too short. Back on Italian, the text was gone; I pasted it again
 * and it said 'Edited elsewhere'." One browser window.
 *
 * A stateful fake Sanity (real revisions, ifRevisionId → 409) runs the REAL
 * saveDigitalCardDraft / openDigitalCardForEdit / getDigitalCard behind the
 * REAL autosave engine, with the editor's send() (open the draft on the first
 * change, then save).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { getDigitalCard, openDigitalCardForEdit, saveDigitalCardDraft } from '../digital-cards'
import { createAutosave, type SendResult } from '@/lib/client/autosave/engine'
import { createMemoryJournal } from '@/lib/client/autosave/journal'
import { DIGITAL_CARD_LIMITS, cardTextLength } from '@/lib/modules/digital-cards/model'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const grant: any = { projectId: 'p', projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm', role: 'owner', permissions: ['digital-cards.read', 'digital-cards.write'], enabledModuleIds: ['digital-cards'] }
const ctx: any = { userId: 'u', platformRole: 'tenant_user', projects: [grant] }

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

/** Content Lake in memory: every write gets a new _rev; ifRevisionId mismatches answer 409. */
function lake(withDraft: boolean) {
  const card = { _id: 'c1', _type: 'digitalCard', _rev: 'p0', projectSlug: 'cyce', kind: 'site', publicId: '11111111-1111-4111-8111-111111111111', links: [] }
  const docs: Record<string, any> = { c1: card }
  if (withDraft) docs['drafts.c1'] = { ...card, _id: 'drafts.c1', _rev: 'd0' }
  let n = 0
  const writes: string[] = []
  /** When set, the next save commits on the server but its answer is lost on the way back to the browser. */
  let loseNextAnswer = false
  const client: any = {
    getDocument: async (id: string) => (docs[id] ? structuredClone(docs[id]) : undefined),
    create: async (d: any) => {
      if (docs[d._id]) throw Object.assign(new Error('exists'), { statusCode: 409 })
      docs[d._id] = { ...structuredClone(d), _rev: `rev${++n}` }
      writes.push(`create:${d._id}`)
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
          const doc = docs[id]
          for (const [k, v] of ops) if (k === 'if' && doc._rev !== v) throw Object.assign(new Error('rev mismatch'), { statusCode: 409 })
          for (const [k, v] of ops) if (k === 'setIfMissing') for (const [path, val] of Object.entries(v)) if (doc[path] === undefined) doc[path] = val
          for (const [k, v] of ops) if (k === 'set') for (const [path, val] of Object.entries(v)) setPath(doc, path, structuredClone(val))
          for (const [k, v] of ops) if (k === 'unset') for (const path of v) unsetPath(doc, path)
          doc._rev = `rev${++n}`
          writes.push(`patch:${id}`)
          return structuredClone(doc)
        },
      }
      return p
    },
    fetch: async (q: string) => {
      if (q.includes('count(*[_type == "project"')) return 1
      if (q.includes('"config": *[_type == "siteConfig"')) return { config: { siteName: 'CYCE', defaultLocale: 'it', supportedLocales: ['it', 'de', 'en'] }, project: {} }
      if (q.includes('_type == "digitalCard"') && q.includes('order(_updatedAt desc)')) return Object.values(docs)
      if (q.includes('_type == "page"') || q.includes('_type == "person"')) return []
      return null
    },
  }
  return {
    docs,
    writes,
    client,
    loseNext: () => (loseNextAnswer = true),
    takeLost: () => {
      const v = loseNextAnswer
      loseNextAnswer = false
      return v
    },
  }
}

/** The editor: one engine per draft, send() = open the draft on the first change, then save. */
async function editor(l: ReturnType<typeof lake>) {
  const deps = { client: l.client } as any
  const snap = await getDigitalCard(ctx, 'p', 'c1', deps)
  let hasDraft = snap.hasDraft
  const refusals: string[] = []
  const send = async (input: { rev: string; set: Record<string, unknown> }): Promise<SendResult> => {
    try {
      let rev = input.rev
      if (!hasDraft || !rev) {
        rev = (await openDigitalCardForEdit(ctx, 'p', { id: 'c1' }, deps)).rev
        hasDraft = true
      }
      const saved = await saveDigitalCardDraft(ctx, 'p', { id: 'c1', rev, set: input.set }, deps)
      if (l.takeLost()) throw new TypeError('Failed to fetch') // committed on the server, the browser never hears back
      return { ok: true, rev: saved.rev }
    } catch (e: any) {
      if (e instanceof TypeError) throw e // a network failure, as the server action would surface it
      refusals.push(e.code)
      return { ok: false, error: e.code }
    }
  }
  const engine = createAutosave({ draftId: 'digital-card:c1', rev: snap.rev, send, storage: createMemoryJournal(), debounceMs: 0, retryDelaysMs: [0] })
  const type = async (set: Record<string, unknown>) => {
    engine.set(set)
    await engine.flush()
  }
  return { engine, refusals, type, deps }
}

// Italian text with emoji: Chrome's maxLength counts grapheme clusters, the server UTF-16 units.
const yoga = (n: number) => 'Om 🧘‍♀️🧘‍♂️ '.repeat(n)
const graphemes = (s: string) => [...new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(s)].length

describe('Tom’s sequence: Italian → German → Italian, one window', () => {
  for (const withDraft of [true, false]) {
    it(`never "edited elsewhere", both languages stored (${withDraft ? 'draft open' : 'published, no draft yet'})`, async () => {
      const l = lake(withDraft)
      const ed = await editor(l)
      await ed.type({ 'description.it': yoga(12) })
      await ed.type({ 'description.de': 'Yoga für alle' })
      await ed.type({ 'description.it': 'Yoga per tutti' })
      expect(ed.refusals).toEqual([])
      expect(ed.engine.state).toBe('saved')
      expect(l.docs['drafts.c1'].description).toMatchObject({ it: 'Yoga per tutti', de: 'Yoga für alle' })
    })
  }

  it('a paste the browser lets through (≤ 300 grapheme clusters) is no longer refused as too long', async () => {
    // Root cause, part 1: the textarea's maxLength (300) let this paste through —
    // Chrome counts it as fewer than 300 characters — but the server counted
    // UTF-16 units, refused it as "too long", and the engine dropped it: the
    // text lived only in the open tab. A reload (the notice offered one) lost it.
    const text = yoga(40).trim()
    expect(graphemes(text)).toBeLessThanOrEqual(300)
    expect(cardTextLength(text)).toBeGreaterThan(300)
    expect(cardTextLength(text)).toBeLessThanOrEqual(DIGITAL_CARD_LIMITS.description)
    const l = lake(true)
    const ed = await editor(l)
    await ed.type({ 'description.it': text })
    expect(ed.engine.rejected).toEqual([])
    expect(l.docs['drafts.c1'].description.it).toBe(text)
  })

  it('a save that landed but whose answer was lost is not "edited elsewhere" when it is sent again', async () => {
    // Root cause, part 2: the save is committed (new revision) but the browser
    // never gets the answer (reload / navigation while in flight, a dropped
    // response). The engine keeps the batch and resends it with the OLD
    // revision; the server refused that as a conflict although the only
    // "other" edit was the person's own. Now the server sees the draft already
    // holds exactly that value and answers with the current revision — nothing
    // is written, nobody's change is overwritten.
    const l = lake(true)
    const ed = await editor(l)
    l.loseNext()
    await ed.type({ 'description.it': 'Ciao' })
    await ed.engine.flush() // the retry
    expect(ed.refusals).toEqual([])
    expect(ed.engine.state).toBe('saved')
    await ed.type({ 'description.de': 'Hallo' })
    expect(ed.refusals).toEqual([])
    expect(l.docs['drafts.c1'].description).toMatchObject({ it: 'Ciao', de: 'Hallo' })
  })

  it('the revision guard still holds: a stale revision with a DIFFERENT value is a conflict, nothing written', async () => {
    const l = lake(true)
    const deps = { client: l.client } as any
    await saveDigitalCardDraft(ctx, 'p', { id: 'c1', rev: 'd0', set: { 'description.it': 'Mia' } }, deps)
    const before = l.writes.length
    await expect(saveDigitalCardDraft(ctx, 'p', { id: 'c1', rev: 'd0', set: { 'description.it': 'Altra' } }, deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(l.writes.length).toBe(before)
    expect(l.docs['drafts.c1'].description.it).toBe('Mia')
  })

  it('a snapshot read while a save lands is not adopted (no rolled-back revision, no wiped text)', async () => {
    // Root cause, part 3: the editor's reload() (after a replayed journal, a
    // lifecycle action …) applied the snapshot and adopted its revision
    // unconditionally. Read before the save landed, it put the older revision
    // back into the engine (next save → "Edited elsewhere") and replaced the
    // text just typed with the older one.
    const l = lake(true)
    const ed = await editor(l)
    const since = ed.engine.confirmed
    const stale = await getDigitalCard(ctx, 'p', 'c1', ed.deps) // the read starts…
    await ed.type({ 'description.it': 'Ciao' }) // …a save lands meanwhile
    expect(ed.engine.adoptRead(stale.rev, since)).toBe(false) // → keep what is on screen and the newer revision
    await ed.type({ 'description.de': 'Hallo' })
    expect(ed.refusals).toEqual([])

    // What the old reload did — setRev(stale) — rolls the engine back:
    const l2 = lake(true)
    const ed2 = await editor(l2)
    const stale2 = await getDigitalCard(ctx, 'p', 'c1', ed2.deps)
    await ed2.type({ 'description.it': 'Ciao' })
    ed2.engine.setRev(stale2.rev)
    await ed2.type({ 'description.de': 'Hallo' })
    expect(ed2.refusals).toEqual(['conflict'])
    expect(ed2.engine.state).toBe('conflict')
  })

  it('a quiet snapshot (nothing saved or waiting meanwhile) is adopted', async () => {
    const l = lake(true)
    const ed = await editor(l)
    await ed.type({ 'description.it': 'Ciao' })
    const since = ed.engine.confirmed
    const fresh = await getDigitalCard(ctx, 'p', 'c1', ed.deps)
    expect(ed.engine.adoptRead(fresh.rev, since)).toBe(true)
    expect(ed.engine.rev).toBe(fresh.rev)
  })
})
