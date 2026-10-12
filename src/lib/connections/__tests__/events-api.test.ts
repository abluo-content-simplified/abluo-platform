import { describe, expect, it } from 'vitest'
import { pauseConnection, revokeConnection } from '../manage'
import { SHAREABLE_RESOURCES } from '../resources'
import { createRateLimiter } from '../rate-limit'
import { decodeCursor, encodeCursor, handleEventsRequest, SETTLE_MS } from '../api/events-endpoint'
import { toEventV1, type EventSiteV1, type EventV1Row } from '../api/event-contract'
import type { EventsSource } from '../api/events-source'
import { PARTNER_EVENTS_PAGE_QUERY } from '../api/event-queries'
import { OPENAPI_V1 } from '../api/openapi'
import { recordRemoval, signWebhook, verifyWebhookSignature } from '../api/removals'
import { P1A, P2, owner, setup } from './fixture'

// ADR-031 V1 step 5 — GET /api/v1/events. The real token engine and the real
// endpoint run; Sanity is replaced by an in-memory source with the same
// contract (ordering, cursor, published-only).

const SITE: EventSiteV1 = {
  defaultLocale: 'it',
  locales: ['it', 'en'],
  timeZone: 'Europe/Rome',
  origin: 'https://damario.it',
  locations: [{ key: 'cervia', name: { it: 'Da Mario Cervia' }, address: { city: 'Cervia', country: 'IT' }, pin: { lat: 44.26, lng: 12.35 } }],
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function row(over: Partial<EventV1Row> = {}): EventV1Row {
  return {
    publicId: uuid(),
    _createdAt: '2026-10-01T10:00:00Z',
    _updatedAt: '2026-10-01T10:00:00Z',
    title: { _type: 'localizedString', it: 'Serata jazz', en: 'Jazz night' },
    slug: { it: { current: 'serata-jazz' }, en: { current: 'jazz-night' } },
    shortDescription: { it: 'Musica dal vivo' },
    startDate: '2026-11-13T19:00:00Z',
    eventStatus: 'scheduled',
    attendanceMode: 'inPerson',
    place: { kind: 'location', locationKey: 'cervia' },
    hosts: [{ name: 'Anna Rossi', role: { it: 'Cantante' } }],
    priceOptions: [{ label: { it: 'Cena' }, amount: 30, currency: 'eur' }],
    ...over,
  }
}

function fakeSource(bySlug: Record<string, { modules?: string[]; site?: EventSiteV1 | null; rows: EventV1Row[] }>) {
  const calls: string[] = []
  const source: EventsSource = {
    async enabledModules(slug) {
      return bySlug[slug]?.modules ?? ['events']
    },
    async site(slug) {
      return bySlug[slug]?.site === undefined ? SITE : bySlug[slug].site!
    },
    async page(q) {
      calls.push(q.projectSlug)
      const t = Date.parse(q.after.t)
      return (bySlug[q.projectSlug]?.rows ?? [])
        .filter((r) => {
          const rt = Date.parse(r._updatedAt!)
          return rt <= Date.parse(q.upTo) && (rt > t || (rt === t && r.publicId! > q.after.id))
        })
        .sort((a, b) => Date.parse(a._updatedAt!) - Date.parse(b._updatedAt!) || a.publicId!.localeCompare(b.publicId!))
        .slice(0, q.limit)
    },
  }
  return { source, calls }
}

async function world(rowsA: EventV1Row[] = [row()], rowsB: EventV1Row[] = [row({ title: { it: 'Livener event' } })]) {
  const f = await setup()
  f.store.projects.get(P1A)!.slug = 'damario'
  f.store.projects.get(P1A)!.customDomain = 'damario.it'
  f.store.projects.get(P2)!.slug = 'livener'
  const app = await f.newApp('TableRes')
  const fake = fakeSource({ damario: { rows: rowsA }, livener: { rows: rowsB } })
  const get = (token: string, query = '', headers: Record<string, string> = {}, extra: Partial<Parameters<typeof handleEventsRequest>[1]> = {}) =>
    handleEventsRequest(
      { method: 'GET', url: `https://abluo.app/api/v1/events${query}`, headers: { authorization: `Bearer ${token}`, ...headers } },
      { store: f.store, source: fake.source, clock: f.clock, limiter: createRateLimiter(1000), ...extra },
    )
  const body = (r: { body: string | null }) => JSON.parse(r.body ?? 'null')
  return { f, app, fake, get, body }
}

describe('GET /api/v1/events — isolation and permissions', () => {
  it('a connection reads only its own project, whatever it sends', async () => {
    const w = await world()
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    const r = await w.get(c.accessToken, '?project=livener')
    expect(r.status).toBe(400) // unknown parameters are refused, not ignored
    const ok = await w.get(c.accessToken)
    expect(ok.status).toBe(200)
    expect(w.fake.calls).toEqual(['damario'])
    expect(w.body(ok).data.map((e: { name: Record<string, string> }) => e.name.it)).toEqual(['Serata jazz'])
  })

  it('events not shared → 403; only granted fields are delivered; personal data only when ticked', async () => {
    const w = await world()
    const venuesOnly = await w.f.connect(w.app, owner('u1', P1A), P1A, { eventVenue: { fields: ['name'] } })
    const denied = await w.get(venuesOnly.accessToken)
    expect(denied.status).toBe(403)
    expect(denied.headers['content-type']).toBe('application/problem+json')

    const w2 = await world()
    const c = await w2.f.connect(w2.app, owner('u1', P1A), P1A, { event: { fields: ['name', 'startDate'] } })
    const ev = w2.body(await w2.get(c.accessToken)).data[0]
    expect(Object.keys(ev).sort()).toEqual(['createdAt', 'id', 'name', 'startDate', 'timeZone', 'updatedAt', 'url'])

    const w3 = await world()
    const withHosts = await w3.f.connect(w3.app, owner('u1', P1A), P1A, { event: { fields: ['name', 'performers'] } })
    expect(w3.body(await w3.get(withHosts.accessToken)).data[0].performers).toEqual([{ name: 'Anna Rossi', role: { it: 'Cantante' } }])
  })

  it('pause or revoke: the very next request is refused', async () => {
    const w = await world()
    const u = owner('u1', P1A)
    const c = await w.f.connect(w.app, u, P1A)
    expect((await w.get(c.accessToken)).status).toBe(200)
    await pauseConnection(u, c.connectionId, w.f.deps)
    expect((await w.get(c.accessToken)).status).toBe(401)
    const w2 = await world()
    const c2 = await w2.f.connect(w2.app, u, P1A)
    await revokeConnection(u, c2.connectionId, w2.f.deps)
    const r = await w2.get(c2.accessToken)
    expect(r.status).toBe(401)
    expect(r.headers['www-authenticate']).toContain('invalid_token')
  })

  it('a website that is not live, or without the Events module, returns nothing', async () => {
    const w = await world()
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    w.f.store.projects.get(P1A)!.status = 'inactive'
    expect((await w.get(c.accessToken)).status).toBe(403)
    w.f.store.projects.get(P1A)!.status = 'active'
    const noModule = fakeSource({ damario: { modules: ['blog'], rows: [row()] } })
    expect((await w.get(c.accessToken, '', {}, { source: noModule.source })).status).toBe(403)
    expect(noModule.calls).toEqual([]) // never queried
  })
})

describe('GET /api/v1/events — sync', () => {
  it('unlisted and website-only events arrive as removals; deletions come from tombstones', async () => {
    const hidden = row({ visibility: 'unlisted', _updatedAt: '2026-10-02T10:00:00Z' })
    const w = await world([row(), hidden, row({ visibility: 'websiteOnly', _updatedAt: '2026-10-03T10:00:00Z' })])
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    await w.f.store.insertTombstone({ project_id: P1A, resource: 'event', public_id: uuid(), reason: 'deleted', removed_at: '2026-10-04T10:00:00.000Z' })
    await w.f.store.insertTombstone({ project_id: P2, resource: 'event', public_id: uuid(), reason: 'deleted', removed_at: '2026-10-04T10:00:00.000Z' })
    const data = w.body(await w.get(c.accessToken)).data
    expect(data.map((d: { deleted?: boolean; reason?: string }) => d.reason ?? 'live')).toEqual(['live', 'unlisted', 'websiteOnly', 'deleted'])
    expect(data[1]).toEqual({ id: hidden.publicId, deleted: true, reason: 'unlisted', updatedAt: '2026-10-02T10:00:00.000Z' })
    expect(Object.keys(data[2]).sort()).toEqual(['deleted', 'id', 'reason', 'updatedAt']) // removals carry no content
  })

  it('paging delivers every change exactly once, in order; the cursor carries over to the next poll', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ _updatedAt: `2026-10-0${1 + (i % 3)}T10:00:00Z` }))
    const w = await world(rows)
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    const seen: string[] = []
    let cursor = ''
    for (let i = 0; i < 10; i++) {
      const b = w.body(await w.get(c.accessToken, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`))
      seen.push(...b.data.map((e: { id: string }) => e.id))
      cursor = b.next_cursor
      if (!b.has_more) break
    }
    expect(seen.sort()).toEqual(rows.map((r) => r.publicId!).sort())
    expect(new Set(seen).size).toBe(7)
    // Nothing new → nothing returned, same position.
    const again = w.body(await w.get(c.accessToken, `?cursor=${cursor}`))
    expect(again.data).toEqual([])
    // A later change arrives on the next poll.
    const later = row({ _updatedAt: new Date(w.f.clock().getTime() + 1000).toISOString() })
    rows.push(later)
    w.f.advance(SETTLE_MS + 2000)
    const next = w.body(await w.get(c.accessToken, `?cursor=${again.next_cursor}`))
    expect(next.data.map((e: { id: string }) => e.id)).toEqual([later.publicId])
  })

  it('changes from the last few seconds wait for the next poll (no gaps from late writes)', async () => {
    const w = await world([])
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    const fresh = row({ _updatedAt: new Date(w.f.clock().getTime() - 1000).toISOString() })
    const rows = [fresh]
    const fake = fakeSource({ damario: { rows } })
    const first = w.body(await w.get(c.accessToken, '', {}, { source: fake.source }))
    expect(first.data).toEqual([])
    w.f.advance(SETTLE_MS + 1000)
    const second = w.body(await w.get(c.accessToken, `?cursor=${first.next_cursor}`, {}, { source: fake.source }))
    expect(second.data.map((e: { id: string }) => e.id)).toEqual([fresh.publicId])
  })

  it('updated_since starts later; bad cursors and parameters are refused as problems', async () => {
    const w = await world([row({ _updatedAt: '2026-09-01T00:00:00Z' }), row({ _updatedAt: '2026-10-05T00:00:00Z' })])
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    expect(w.body(await w.get(c.accessToken, '?updated_since=2026-10-01T00:00:00Z')).data).toHaveLength(1)
    for (const q of ['?cursor=nope', '?limit=0', '?limit=500', '?updated_since=yesterday', '?cursor=x&updated_since=2026-01-01T00:00:00Z', `?cursor=${Buffer.from(JSON.stringify({ v: 1, t: '2026-01-01T00:00:00Z', id: "x' || true" })).toString('base64url')}`]) {
      const r = await w.get(c.accessToken, q)
      expect(r.status, q).toBe(400)
      expect(w.body(r)).toMatchObject({ type: expect.stringMatching(/^https:\/\//), status: 400 })
    }
  })

  it('ETag: an unchanged page answers 304', async () => {
    const w = await world()
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    const first = await w.get(c.accessToken)
    const again = await w.get(c.accessToken, '', { 'if-none-match': first.headers.etag })
    expect(again.status).toBe(304)
    expect(again.body).toBeNull()
  })

  it('rate limit per connection, and every call is metered', async () => {
    const w = await world()
    const c = await w.f.connect(w.app, owner('u1', P1A), P1A)
    const limiter = createRateLimiter(2)
    const statuses = [] as number[]
    for (let i = 0; i < 3; i++) statuses.push((await w.get(c.accessToken, '', {}, { limiter })).status)
    expect(statuses).toEqual([200, 200, 429])
    expect(w.f.store.usage.map((u) => u.status)).toEqual([200, 200, 429])
    expect(w.f.store.usage[0]).toMatchObject({ method: 'GET', endpoint: '/api/v1/events', connection_id: c.connectionId })
  })

  it('cursors round-trip and never accept junk', () => {
    const c = { t: '2026-10-01T10:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('!!')).toBeNull()
  })
})

describe('Event v1 contract', () => {
  it('maps a published event: every site language, link back, structured place, prices; no Sanity id', () => {
    const r = row()
    const ev = toEventV1({ ...r, ...({ _id: 'damario-event-jazz' } as object) }, SITE)!
    expect(ev).toMatchObject({
      id: r.publicId,
      url: { it: 'https://damario.it/it/events/serata-jazz', en: 'https://damario.it/en/events/jazz-night' },
      name: { it: 'Serata jazz', en: 'Jazz night' },
      timeZone: 'Europe/Rome',
      location: { name: { it: 'Da Mario Cervia' }, address: { city: 'Cervia', country: 'IT' }, geo: { latitude: 44.26, longitude: 12.35 } },
      offers: [{ price: 30, currency: 'EUR', availability: 'InStock' }],
    })
    expect(JSON.stringify(ev)).not.toContain('damario-event-jazz')
    expect(ev.name).not.toHaveProperty('_type')
  })

  it('online events have no place; sold out marks every offer', () => {
    const ev = toEventV1(row({ attendanceMode: 'online', eventStatus: 'soldOut' }), SITE)!
    expect(ev.location).toBeNull()
    expect(ev.offers.every((o) => o.availability === 'SoldOut')).toBe(true)
  })

  it('every shareable field exists in the contract and in the OpenAPI description', () => {
    const ev = toEventV1(row(), SITE)!
    const def = SHAREABLE_RESOURCES.event
    const props = Object.keys(OPENAPI_V1.components.schemas.EventV1.properties)
    for (const f of [...def.core, ...def.public, ...def.personal]) {
      expect(Object.keys(ev), f).toContain(f)
      expect(props, f).toContain(f)
    }
    expect(Object.keys(ev).sort()).toEqual(props.slice().sort())
  })

  it('the Sanity query is scoped to the project and to published documents only', () => {
    const q = PARTNER_EVENTS_PAGE_QUERY
    expect(q).toContain('projectSlug == $projectSlug')
    expect(q).toContain('!(_id in path("drafts.**"))')
    expect(q).toContain('!(_id in path("versions.**"))')
    expect(q).toContain('[0...201]') // hard cap per read
    expect(q).toContain('venue->projectSlug == $projectSlug') // no cross-project venue
    for (const websiteOnly of ['embedVideoUrl', 'primaryStreamUrl', 'featuredOnLivePage', 'gallery', 'schedule']) expect(q).not.toContain(websiteOnly)
  })
})

describe('removals webhook', () => {
  it('only correctly signed, recent calls are accepted', () => {
    const body = JSON.stringify({ type: 'event', publicId: uuid(), projectSlug: 'damario' })
    const now = Date.now()
    const header = signWebhook(body, 'sekret', now)
    expect(verifyWebhookSignature(header, body, 'sekret', now)).toBe(true)
    expect(verifyWebhookSignature(header, body + ' ', 'sekret', now)).toBe(false)
    expect(verifyWebhookSignature(header, body, 'other', now)).toBe(false)
    expect(verifyWebhookSignature(header, body, 'sekret', now + 10 * 60 * 1000)).toBe(false)
    expect(verifyWebhookSignature(null, body, 'sekret', now)).toBe(false)
  })

  it('records a tombstone for a known project; ignores everything else', async () => {
    const w = await world()
    const id = uuid()
    expect(await recordRemoval({ type: 'event', publicId: id, projectSlug: 'damario' }, w.f.deps)).toEqual({ ok: true, recorded: true })
    expect(w.f.store.tombstones[0]).toMatchObject({ project_id: P1A, public_id: id, reason: 'deleted', resource: 'event' })
    expect(await recordRemoval({ type: 'event', publicId: id, projectSlug: 'nobody' }, w.f.deps)).toEqual({ ok: true, recorded: false })
    expect(await recordRemoval({ type: 'siteConfig', publicId: id, projectSlug: 'damario' }, w.f.deps)).toEqual({ ok: true, recorded: false })
    // Any shareable type is covered by the same webhook (venues today; posts, menus later).
    const venue = uuid()
    expect(await recordRemoval({ type: 'eventVenue', publicId: venue, projectSlug: 'damario' }, w.f.deps)).toEqual({ ok: true, recorded: true })
    expect(w.f.store.tombstones.at(-1)).toMatchObject({ resource: 'eventVenue', public_id: venue })
    expect(await recordRemoval({ type: 'event', publicId: 'damario-event-x', projectSlug: 'damario' }, w.f.deps)).toEqual({ ok: true, recorded: false })
    expect(w.f.store.tombstones).toHaveLength(2)
  })
})
