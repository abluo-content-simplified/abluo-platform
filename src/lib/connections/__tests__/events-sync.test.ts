import { describe, expect, it } from 'vitest'
import { parse, evaluate } from 'groq-js'
import { createRateLimiter } from '../rate-limit'
import { decodeCursor, encodeCursor, handleEventsRequest, SETTLE_MS } from '../api/events-endpoint'
import { partnerRemovalReason, type EventSiteV1, type EventV1Row } from '../api/event-contract'
import type { EventsSource } from '../api/events-source'
import { PARTNER_EVENTS_EXISTING_QUERY, PARTNER_EVENTS_PAGE_QUERY } from '../api/event-queries'
import { EFFECTIVE_CHANGE_MS_GROQ, effectiveChangeMs } from '../api/sync'
import { OPENAPI_V1 } from '../api/openapi'
import { P1A, owner, setup } from './fixture'

// ADR-032 D11 — boundary-aware, fixed-window sync. A simulated consumer applies
// every row it receives (upsert by id / delete by id, in order) and must end
// up holding exactly what the website shows, whatever happens during paging.

const SITE: EventSiteV1 = { defaultLocale: 'it', locales: ['it'], timeZone: 'Europe/Rome', origin: 'https://damario.it', locations: [] }
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
type Doc = EventV1Row & { publicId: string }

async function world(initialDocs: (now: number) => Doc[] = () => []) {
  const f = await setup()
  f.store.projects.get(P1A)!.slug = 'damario'
  f.store.projects.get(P1A)!.customDomain = 'damario.it'
  const now = () => f.clock().getTime()
  const iso = (ms: number) => new Date(ms).toISOString()
  const docs = new Map<string, Doc>(initialDocs(now()).map((d) => [d.publicId, d]))
  const dataset = () => [...docs.values()].map((d) => ({ _id: `damario-event-${d.publicId}`, _type: 'event', projectSlug: 'damario', ...d }))
  const source: EventsSource = {
    enabledModules: async () => ['events'],
    site: async () => SITE,
    async page(q) {
      const params = { projectSlug: q.projectSlug, afterMs: Date.parse(q.after.t), afterId: q.after.id, upToMs: Date.parse(q.upTo) }
      return ((await (await evaluate(parse(PARTNER_EVENTS_PAGE_QUERY), { dataset: dataset(), params })).get()) as EventV1Row[]).slice(0, q.limit)
    },
    async existing(slug, publicIds) {
      return (await (await evaluate(parse(PARTNER_EVENTS_EXISTING_QUERY), { dataset: dataset(), params: { projectSlug: slug, publicIds } })).get()) as string[]
    },
  }
  const app = await f.newApp('TableRes')
  const token = (await f.connect(app, owner('u1', P1A), P1A)).accessToken
  const get = async (query: string) => {
    const r = await handleEventsRequest(
      { method: 'GET', url: `https://abluo.app/api/v1/events${query}`, headers: { authorization: `Bearer ${token}` } },
      { store: f.store, source, clock: f.clock, limiter: createRateLimiter(100000) }
    )
    expect(r.status, r.body ?? '').toBe(200)
    return JSON.parse(r.body!) as { data: Row[]; has_more: boolean; next_cursor: string }
  }

  // ── Editing the website ──
  const event = (o: Partial<Doc> = {}): Doc => {
    const t = iso(now() - 60_000)
    return { publicId: uuid(), _createdAt: t, _updatedAt: t, title: { it: 'Serata' }, slug: { it: { current: 'serata' } }, ...o }
  }
  const create = (o: Partial<Doc> = {}) => {
    const d = { ...event(o), _updatedAt: iso(now()), ...o }
    docs.set(d.publicId, d)
    return d
  }
  const edit = (id: string, patch: Partial<Doc>) => docs.set(id, { ...docs.get(id)!, ...patch, _updatedAt: iso(now()) })
  const remove = async (id: string, reason: 'deleted' | 'unpublished' = 'deleted') => {
    docs.delete(id)
    await f.store.insertTombstone({ project_id: P1A, resource: 'event', public_id: id, reason, removed_at: iso(now()) })
  }
  const republish = (d: Doc) => docs.set(d.publicId, { ...d, _updatedAt: iso(now()) })

  // ── The consumer ──
  const held = new Map<string, Row>()
  let cursor = ''
  const pages: Row[][] = []
  /** One sweep: pages until has_more is false. `between(i)` runs after page i. */
  const sweep = async (opts: { limit?: number; query?: string; between?: (page: number) => void | Promise<void> } = {}) => {
    const rows: Row[] = []
    for (let i = 0; i < 100; i++) {
      const q = i === 0 && opts.query !== undefined ? opts.query : cursor ? `?cursor=${cursor}` : ''
      const b = await get(`${q}${q ? '&' : '?'}limit=${opts.limit ?? 50}`)
      const ids = b.data.map((r) => r.id)
      expect(new Set(ids).size, 'one row per id per response').toBe(ids.length)
      for (const r of b.data) {
        if (r.deleted) held.delete(r.id)
        else held.set(r.id, r)
      }
      rows.push(...b.data)
      pages.push(b.data)
      cursor = b.next_cursor
      if (!b.has_more) return rows
      await opts.between?.(i)
    }
    throw new Error('sweep did not end')
  }
  /** Lets every write settle, then sweeps once more. */
  const catchUp = async () => {
    f.advance(SETTLE_MS + 1000)
    return sweep()
  }
  /** What the website shows right now. */
  const truth = () => {
    const w = new Date(now())
    return new Map([...docs.values()].filter((d) => partnerRemovalReason(d, w) === null).map((d) => [d.publicId, d]))
  }
  const expectInSync = () => {
    const t = truth()
    expect([...held.keys()].sort()).toEqual([...t.keys()].sort())
    for (const [id, d] of t) expect(held.get(id)?.name, id).toEqual(d.title && { it: (d.title as { it: string }).it })
  }
  return { f, now, iso, docs, event, create, edit, remove, republish, sweep, catchUp, expectInSync, held, pages, get, getCursor: () => cursor, setCursor: (c: string) => (cursor = c) }
}
type Row = { id: string; deleted?: true; reason?: string; updatedAt: string; name?: Record<string, string> }

describe('effective change time', () => {
  it('the GROQ expression and its JS twin agree (integer ms; future dates ignored)', async () => {
    const base = Date.parse('2026-10-13T10:00:00.000Z')
    const docs = [
      { _updatedAt: '2026-10-13T09:00:00Z' },
      { _updatedAt: '2026-10-13T09:00:00Z', publishedAt: '2026-10-13T09:30:00.250Z' },
      { _updatedAt: '2026-10-13T09:00:00Z', publishedAt: '2026-10-13T11:00:00Z' }, // future: ignored
      { _updatedAt: '2026-10-13T09:00:00Z', expiresAt: '2026-10-13T09:59:59.999Z', archivedAt: '2026-10-13T09:10:00Z' },
      { _updatedAt: '2026-10-13T10:00:00.001Z' }, // after the window: no effective time yet
    ]
    for (const d of docs) {
      const groq = await (await evaluate(parse(EFFECTIVE_CHANGE_MS_GROQ), { root: d, params: { upToMs: base } })).get()
      expect(groq ?? null).toBe(effectiveChangeMs(d, base))
    }
    expect(effectiveChangeMs(docs[1], base)).toBe(Date.parse('2026-10-13T09:30:00.250Z'))
    expect(effectiveChangeMs(docs[2], base)).toBe(Date.parse('2026-10-13T09:00:00Z'))
  })
})

describe('fixed-window paging', () => {
  it('equal timestamps: the public id breaks ties; without concurrent changes every item arrives exactly once', async () => {
    const w = await world((now) => Array.from({ length: 7 }, () => ({ publicId: uuid(), _createdAt: new Date(now - 60_000).toISOString(), _updatedAt: new Date(now - 60_000).toISOString(), title: { it: 'x' } })))
    const rows = await w.sweep({ limit: 2 })
    expect(rows.map((r) => r.id)).toEqual([...w.docs.keys()].sort())
    expect(w.pages.length).toBe(4)
    w.expectInSync()
  })

  it('the window end is fixed for the whole sweep: later writes wait for the next sweep', async () => {
    const w = await world((now) => Array.from({ length: 4 }, (_, i) => ({ publicId: uuid(), _createdAt: new Date(now - 60_000 + i).toISOString(), _updatedAt: new Date(now - 60_000 + i).toISOString(), title: { it: 'x' } })))
    let late = ''
    const rows = await w.sweep({
      limit: 2,
      between: () => {
        late = w.create({ title: { it: 'late' } }).publicId // something new appears…
        w.f.advance(SETTLE_MS * 3) // …and has long settled before the next page is asked for
      },
    })
    expect(rows.map((r) => r.id)).not.toContain(late) // the sweep's window end did not move
    expect(w.pages.length).toBe(2)
    expect((await w.catchUp()).map((r) => r.id)).toContain(late)
    w.expectInSync()
  })

  it('an item edited during paging — already delivered, or not yet — ends up current (next sweep re-delivers it)', async () => {
    const w = await world((now) => Array.from({ length: 6 }, (_, i) => ({ publicId: uuid(), _createdAt: new Date(now - 60_000 + i).toISOString(), _updatedAt: new Date(now - 60_000 + i).toISOString(), title: { it: `v1-${i}` } })))
    const [first, , , , , lastId] = [...w.docs.keys()]
    await w.sweep({ limit: 2, between: (p) => {
      if (p === 0) {
        w.edit(first, { title: { it: 'first v2' } }) // delivered on page 1, changed afterwards
        w.edit(lastId, { title: { it: 'last v2' } }) // not delivered yet
      }
    } })
    await w.catchUp()
    w.expectInSync()
    expect(w.held.get(first)?.name).toEqual({ it: 'first v2' })
    expect(w.held.get(lastId)?.name).toEqual({ it: 'last v2' })
  })

  it('archive, delete and republish during paging: the consumer converges', async () => {
    const w = await world((now) => Array.from({ length: 6 }, (_, i) => ({ publicId: uuid(), _createdAt: new Date(now - 60_000 + i).toISOString(), _updatedAt: new Date(now - 60_000 + i).toISOString(), title: { it: `e${i}` } })))
    const ids = [...w.docs.keys()]
    const gone = w.docs.get(ids[4])!
    await w.sweep({ limit: 2, between: async (p) => {
      if (p === 0) {
        w.edit(ids[0], { archivedAt: w.iso(w.now()), expiresAt: w.iso(w.now()) }) // archived after delivery
        await w.remove(ids[1]) // deleted after delivery
        await w.remove(ids[4]) // deleted before delivery…
      }
      if (p === 1) w.republish(gone) // …and republished before the sweep ends
    } })
    const next = await w.catchUp()
    expect(next.find((r) => r.id === ids[0])).toMatchObject({ deleted: true, reason: 'archived' })
    expect(next.find((r) => r.id === ids[1])).toMatchObject({ deleted: true, reason: 'deleted' })
    expect(next.filter((r) => r.id === ids[4])).toEqual([expect.objectContaining({ name: { it: 'e4' } })]) // never reported removed
    w.expectInSync()
  })

  it('repeating a page is harmless: same rows, same state', async () => {
    const w = await world((now) => [{ publicId: uuid(), _createdAt: new Date(now - 60_000).toISOString(), _updatedAt: new Date(now - 60_000).toISOString(), title: { it: 'x' } }])
    const start = w.getCursor()
    const a = await w.sweep()
    w.setCursor(start)
    const b = await w.sweep()
    expect(b).toEqual(a)
    w.expectInSync()
  })
})

describe('tombstones and republishing', () => {
  it('older tombstone → republish: a consumer polling afterwards gets the item, never a removal', async () => {
    const w = await world()
    const d = w.create({ title: { it: 'back' } })
    await w.catchUp()
    w.f.advance(1000)
    await w.remove(d.publicId, 'unpublished')
    w.f.advance(1000)
    w.republish(d)
    const rows = await w.catchUp()
    expect(rows.filter((r) => r.id === d.publicId)).toEqual([expect.objectContaining({ id: d.publicId, name: { it: 'back' } })])
    w.expectInSync()
  })

  it('older tombstone → republish: a consumer that polled in between sees removal, then the item', async () => {
    const w = await world()
    const d = w.create()
    await w.catchUp()
    await w.remove(d.publicId, 'unpublished')
    expect((await w.catchUp()).filter((r) => r.id === d.publicId)).toEqual([expect.objectContaining({ deleted: true, reason: 'unpublished' })])
    w.republish(d)
    expect((await w.catchUp()).filter((r) => r.id === d.publicId)).toEqual([expect.objectContaining({ id: d.publicId, name: { it: 'Serata' } })])
    w.expectInSync()
  })

  it('a late removal webhook (recorded after the republish) never removes the republished item', async () => {
    const w = await world()
    const d = w.create({ title: { it: 'still here' } })
    await w.catchUp()
    // Studio: unpublish, republish a moment later; the unpublish webhook is retried and lands after both.
    w.f.advance(1000)
    w.republish(d)
    w.f.advance(3000)
    await w.remove(d.publicId, 'unpublished')
    w.docs.set(d.publicId, { ...d, _updatedAt: w.docs.get(d.publicId)?._updatedAt ?? w.iso(w.now() - 3000) }) // the document exists
    const rows = (await w.catchUp()).filter((r) => r.id === d.publicId)
    expect(rows.every((r) => !r.deleted)).toBe(true)
    expect(w.held.get(d.publicId)?.name).toEqual({ it: 'still here' })
  })

  it('republish → later deletion: the removal wins, reported once per response', async () => {
    const w = await world()
    const d = w.create()
    await w.catchUp()
    await w.remove(d.publicId, 'unpublished')
    w.f.advance(1000)
    w.republish(d)
    w.f.advance(1000)
    await w.remove(d.publicId, 'deleted')
    const rows = (await w.catchUp()).filter((r) => r.id === d.publicId)
    expect(rows).toEqual([expect.objectContaining({ deleted: true, reason: 'deleted' })])
    w.expectInSync()
    expect(w.held.has(d.publicId)).toBe(false)
  })
})

describe('publication boundaries', () => {
  it('initial sync never discloses a never-public scheduled item; it arrives in full when its date passes — no edit needed', async () => {
    const w = await world()
    const soon = w.create({ title: { it: 'domani' } })
    w.edit(soon.publicId, { publishedAt: w.iso(w.now() + 10 * 60_000) })
    w.f.advance(SETTLE_MS + 1000)
    const initial = await w.sweep()
    expect(initial.map((r) => r.id)).not.toContain(soon.publicId)
    w.f.advance(10 * 60_000)
    const later = await w.sweep()
    expect(later).toEqual([expect.objectContaining({ id: soon.publicId, name: { it: 'domani' } })])
    expect(Date.parse(later[0].updatedAt)).toBe(Date.parse(w.docs.get(soon.publicId)!.publishedAt!))
    w.expectInSync()
  })

  it('incremental sync reports a not-yet-public item as removed ("unpublished") — a no-op for consumers who never saw it', async () => {
    const w = await world()
    const d = w.create()
    w.edit(d.publicId, { publishedAt: w.iso(w.now() + 10 * 60_000) })
    w.f.advance(SETTLE_MS + 1000)
    const rows = await w.sweep({ query: '?updated_since=2026-01-01T00:00:00Z' })
    expect(rows).toEqual([expect.objectContaining({ id: d.publicId, deleted: true, reason: 'unpublished' })])
    w.expectInSync()
  })

  it('an end date passing is delivered as a removal without any edit; published and expired between two polls is one removal', async () => {
    const w = await world()
    const ends = w.create({ title: { it: 'ends' } })
    w.edit(ends.publicId, { expiresAt: w.iso(w.now() + 60_000) })
    await w.catchUp()
    expect(w.held.has(ends.publicId)).toBe(true)
    const brief = w.create({ title: { it: 'brief' } })
    w.edit(brief.publicId, { publishedAt: w.iso(w.now() + 10_000), expiresAt: w.iso(w.now() + 20_000) })
    w.f.advance(2 * 60_000)
    const rows = await w.catchUp()
    expect(rows.filter((r) => r.id === ends.publicId)).toEqual([expect.objectContaining({ deleted: true, reason: 'unpublished' })])
    expect(rows.filter((r) => r.id === brief.publicId)).toEqual([expect.objectContaining({ deleted: true, reason: 'unpublished' })])
    w.expectInSync()
  })

  it('archived takes precedence over every other reason', () => {
    const w = new Date('2026-10-13T10:00:00Z')
    expect(partnerRemovalReason({ visibility: 'unlisted', archivedAt: '2026-10-13T09:00:00Z', expiresAt: '2026-10-13T09:00:00Z' }, w)).toBe('archived')
    expect(partnerRemovalReason({ visibility: 'unlisted', expiresAt: '2026-10-13T09:00:00Z' }, w)).toBe('unpublished')
    expect(partnerRemovalReason({ visibility: 'websiteOnly' }, w)).toBe('websiteOnly')
    expect(partnerRemovalReason({}, w)).toBeNull() // events today: no lifecycle dates → as before
  })
})

describe('cursor and contract', () => {
  it('v1 cursors without a window end still work; a window end is never later than now − settle; inconsistent cursors are refused', () => {
    expect(decodeCursor(encodeCursor({ t: '2026-10-01T10:00:00.000Z', id: '' }))).toEqual({ t: '2026-10-01T10:00:00.000Z', id: '' })
    const mid = { t: '2026-10-01T10:00:00.000Z', id: '00000000-0000-4000-8000-000000000001', w: '2026-10-02T00:00:00.000Z', i: true }
    expect(decodeCursor(encodeCursor(mid))).toEqual(mid)
    const raw = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    expect(decodeCursor(raw({ v: 1, t: '2026-10-03T00:00:00Z', id: '', w: '2026-10-02T00:00:00Z' }))).toBeNull() // position after window end
    expect(decodeCursor(raw({ v: 1, t: '2026-10-01T00:00:00Z', id: '', i: true }))).toBeNull() // initial flag without a window
    expect(decodeCursor(raw({ v: 1, t: '2026-10-01T00:00:00Z', id: '', w: 'soon' }))).toBeNull()
  })

  it('a forged future window end is clamped to now − settle', async () => {
    const w = await world()
    const fresh = w.create() // _updatedAt = now: not settled
    const forged = encodeCursor({ t: '2026-01-01T00:00:00.000Z', id: '', w: w.iso(w.now() + 3600_000) })
    const b = await w.get(`?cursor=${forged}`)
    expect(b.data.map((r) => r.id)).not.toContain(fresh.publicId)
  })

  it('OpenAPI lists the archived reason and tells consumers to tolerate unknown reasons and repeated rows', () => {
    const removed = OPENAPI_V1.components.schemas.EventRemovedV1 as unknown as { properties: { reason: { enum: string[]; description?: string } }; description: string }
    expect(removed.properties.reason.enum).toContain('archived')
    expect(removed.properties.reason.description).toMatch(/unknown/i)
    const op = OPENAPI_V1.paths['/api/v1/events'].get.description
    expect(op).toMatch(/at least once/i)
    expect(op).toMatch(/deleted: true/)
  })
})
