import { describe, expect, it, vi } from 'vitest'
import { deliverRow, processOutbox, type ConsumerDeps, type SiteContext } from '../consumer'
import type { Content } from '../data'
import { MAX_ATTEMPTS, STALE_CLAIM_MS, backoffMs, createSupabaseOutboxRepo, dueFilter, type FinalizePatch, type OutboxRepo, type OutboxRow } from '../outbox'
import { hasTokens, stripTokens } from '../tokens-strip'
import { fakeDb, opsOf } from '../../server/__tests__/fake-db'

const NOW = new Date('2026-11-08T10:00:00Z')
const P = '00000000-0000-4000-8000-00000000000a'
const B = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'A'.repeat(43)

const site: SiteContext = { name: 'Yoga Club', slug: 'cyce', customDomain: 'cyce.info', defaultLocale: 'it', timeZone: 'Europe/Rome', replyTo: 'info@cyce.info', logoUrl: null }
const content: Content = {
  booking: { reference: 'CYCE-7K2MQ', totalCents: 5000, purchaserName: 'Anna Rossi', locale: 'it', anonymised: false, holdExpiresAt: null },
  sessions: [{ startsAt: '2026-11-12T17:30:00Z', timeZone: 'Europe/Rome' }],
  paymentInstructions: { it: 'Bonifico' }, bankDetails: { it: 'IBAN IT00' },
}

const row = (o: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'r1', project_id: P, booking_id: B, pass_id: null, intent: 'booking.confirmed', dedupe_key: 'k1',
  recipients: [{ email: 'anna@example.it', name: 'Anna Rossi' }], locale: 'it',
  payload: { reference: 'CYCE-7K2MQ', totalCents: 5000, managementToken: TOKEN, passTokens: [{ attendeeKey: 'a0', token: TOKEN.replace('A', 'B') }] },
  environment: 'production', status: 'delivering', attempts: 0, provider_message_id: null, ...o,
})

/** An in-memory outbox with the real claim semantics (status, due time, stale claim, environment). */
function memRepo(rows: OutboxRow[], extra: Record<string, { next?: string; claimedAt?: string }> = {}) {
  const state = new Map(rows.map((r) => [r.id, { ...r, ...(extra[r.id] ?? {}), next: extra[r.id]?.next ?? '2026-11-08T00:00:00Z', claimedAt: extra[r.id]?.claimedAt ?? null as string | null }]))
  const finals: Array<{ id: string; patch: FinalizePatch }> = []
  const due = (r: ReturnType<typeof state.get>, now: Date) =>
    !!r && ((['pending', 'failed'].includes(r.status) && new Date(r.next) <= now) ||
      (r.status === 'delivering' && (!r.claimedAt || new Date(r.claimedAt).getTime() < now.getTime() - STALE_CLAIM_MS)))
  const repo: OutboxRepo = {
    async listDueIds(env, now, limit) { return [...state.values()].filter((r) => r.environment === env && due(r, now)).slice(0, limit).map((r) => r.id) },
    async claim(id, env, now) {
      const r = state.get(id)
      if (!r || r.environment !== env || !due(r, now)) return null
      r.status = 'delivering'; r.claimedAt = now.toISOString()
      return { ...r }
    },
    async finalize(id, patch) {
      const r = state.get(id)
      if (!r || r.status !== 'delivering') return false
      finals.push({ id, patch }); Object.assign(r, { status: patch.status, attempts: patch.attempts, claimedAt: null, ...(patch.next_attempt_at ? { next: patch.next_attempt_at } : {}), ...(patch.payload ? { payload: patch.payload } : {}) })
      return true
    },
  }
  return { repo, state, finals }
}

function deps(over: Partial<ConsumerDeps> & { rows?: OutboxRow[] } = {}) {
  const m = memRepo(over.rows ?? [])
  const send = vi.fn(async () => ({ ok: true, id: 'resend-1' }))
  const d: ConsumerDeps = {
    repo: m.repo, environment: 'production', now: () => NOW, send,
    loadSite: async () => site, loadContent: async () => content, ...over,
  }
  return { d, send, ...m }
}

describe('stripTokens', () => {
  it('removes every *Token / *Tokens key, nested too, keeps the rest', () => {
    const out = stripTokens({ reference: 'R', managementToken: 'x', passTokens: [{ token: 'y' }], deep: { calendarToken: 'z', keep: 1 }, list: [{ pass_token: 'q', ok: true }] })
    expect(out).toEqual({ reference: 'R', deep: { keep: 1 }, list: [{ ok: true }] })
    expect(hasTokens(out)).toBe(false)
  })
})

describe('deliverRow', () => {
  it('delivers: Resend id stored, tokens stripped, sender = site name + Reply-To tenant address, links built from the tokens', async () => {
    const x = deps({ rows: [row()] })
    const claimed = await x.repo.claim('r1', 'production', NOW)
    expect(await deliverRow(claimed!, x.d)).toBe('delivered')
    const [call] = x.send.mock.calls as unknown as Array<[{ to: string[]; fromName: string; replyTo: string; html: string; text: string; subject: string }]>
    expect(call[0].to).toEqual(['anna@example.it'])
    expect(call[0].fromName).toBe('Yoga Club')
    expect(call[0].replyTo).toBe('info@cyce.info')
    expect(call[0].text).toContain(`https://www.cyce.info/it/booking/${TOKEN}`)
    expect(call[0].subject).toContain('confermata')
    const fin = x.finals[0].patch
    expect(fin).toMatchObject({ status: 'delivered', provider_message_id: 'resend-1', last_error: null })
    expect(hasTokens(fin.payload)).toBe(false)
    expect(fin.payload).toMatchObject({ reference: 'CYCE-7K2MQ' })
  })

  it('a Resend failure backs off, keeps the tokens for the retry, and goes dead after MAX_ATTEMPTS', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'resend 500' }))
    const a = deps({ rows: [row()], send })
    expect(await deliverRow((await a.repo.claim('r1', 'production', NOW))!, a.d)).toBe('failed')
    expect(a.finals[0].patch).toMatchObject({ status: 'failed', attempts: 1 })
    expect(a.finals[0].patch.payload).toBeUndefined()
    expect(new Date(a.finals[0].patch.next_attempt_at!).getTime() - NOW.getTime()).toBe(backoffMs(1))

    const b = deps({ rows: [row({ attempts: MAX_ATTEMPTS - 1 })], send })
    expect(await deliverRow((await b.repo.claim('r1', 'production', NOW))!, b.d)).toBe('dead')
    expect(hasTokens(b.finals[0].patch.payload)).toBe(false)
  })

  it('a thrown error (e.g. data read) is a retry, not a crash', async () => {
    const x = deps({ rows: [row()], loadContent: async () => { throw new Error('db down') } })
    expect(await deliverRow((await x.repo.claim('r1', 'production', NOW))!, x.d)).toBe('failed')
    expect(x.finals[0].patch.last_error).toBe('db down')
  })

  it('never resends a row that already has a provider_message_id', async () => {
    const x = deps({ rows: [row({ provider_message_id: 'old-id' })] })
    expect(await deliverRow((await x.repo.claim('r1', 'production', NOW))!, x.d)).toBe('delivered')
    expect(x.send).not.toHaveBeenCalled()
  })

  it('unknown intent is dead; anonymised or vanished booking / project is skipped, tokens stripped', async () => {
    const u = deps({ rows: [row({ intent: 'nope.nope' })] })
    expect(await deliverRow((await u.repo.claim('r1', 'production', NOW))!, u.d)).toBe('dead')
    const a = deps({ rows: [row()], loadContent: async () => ({ ...content, booking: { ...content.booking!, anonymised: true } }) })
    expect(await deliverRow((await a.repo.claim('r1', 'production', NOW))!, a.d)).toBe('skipped')
    const g = deps({ rows: [row()], loadContent: async () => ({ ...content, booking: null }) })
    expect(await deliverRow((await g.repo.claim('r1', 'production', NOW))!, g.d)).toBe('skipped')
    const p = deps({ rows: [row()], loadSite: async () => null })
    expect(await deliverRow((await p.repo.claim('r1', 'production', NOW))!, p.d)).toBe('skipped')
    expect(hasTokens(p.finals[0].patch.payload)).toBe(false)
    expect(a.send).not.toHaveBeenCalled()
  })

  it('empty recipients (anonymised / no address) are skipped, never sent', async () => {
    const x = deps({ rows: [row({ recipients: [] })] })
    expect(await deliverRow((await x.repo.claim('r1', 'production', NOW))!, x.d)).toBe('skipped')
    const bad = deps({ rows: [row({ recipients: [{ email: 'not-an-email' }] })] })
    expect(await deliverRow((await bad.repo.claim('r1', 'production', NOW))!, bad.d)).toBe('skipped')
  })
})

describe('environment gate (D16.5)', () => {
  const pre = (over: Partial<ConsumerDeps> = {}) => deps({ rows: [row({ environment: 'preview' })], environment: 'preview', ...over })

  it('outside production without RESERVATIONS_TEST_RECIPIENT: skipped, nothing sent', async () => {
    const x = pre()
    const r = await processOutbox(x.d)
    expect(r.outcomes.skipped).toBe(1)
    expect(x.send).not.toHaveBeenCalled()
    expect(hasTokens(x.finals[0].patch.payload)).toBe(false)
  })
  it('outside production with a test recipient: only the test recipient is mailed, marked TEST', async () => {
    const x = pre({ testRecipient: 'tom@tmz.it' })
    await processOutbox(x.d)
    const [[sent]] = x.send.mock.calls as unknown as Array<[{ to: string[]; subject: string }]>
    expect(sent.to).toEqual(['tom@tmz.it'])
    expect(sent.subject.startsWith('[TEST]')).toBe(true)
  })
  it('rows of another environment are never claimed', async () => {
    const x = deps({ rows: [row({ environment: 'preview' })], environment: 'production' })
    const r = await processOutbox(x.d)
    expect(r.due).toBe(0)
    expect(x.send).not.toHaveBeenCalled()
    const y = deps({ rows: [row({ environment: 'production' })], environment: 'preview', testRecipient: 'tom@tmz.it' })
    expect((await processOutbox(y.d)).due).toBe(0)
  })
})

describe('claim and dedupe', () => {
  it('a delivering row is claimable only after 10 minutes; fresh claims and delivered rows are left alone', async () => {
    const stale = new Date(NOW.getTime() - STALE_CLAIM_MS - 1000).toISOString()
    const fresh = new Date(NOW.getTime() - 60_000).toISOString()
    const m = memRepo(
      [row({ id: 'stale' }), row({ id: 'fresh' }), row({ id: 'done', status: 'delivered' }), row({ id: 'pend', status: 'pending' }), row({ id: 'later', status: 'failed' })],
      { stale: { claimedAt: stale }, fresh: { claimedAt: fresh }, later: { next: '2026-11-09T00:00:00Z' } },
    )
    const ids = (await m.repo.listDueIds('production', NOW, 25)) as string[]
    expect(ids.sort()).toEqual(['pend', 'stale'])
  })
  it('two runners cannot both get a row', async () => {
    const m = memRepo([row({ status: 'pending' })])
    const [a, b] = await Promise.all([m.repo.claim('r1', 'production', NOW), m.repo.claim('r1', 'production', NOW)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })
  it('processOutbox: counts outcomes, a lost claim is a noop, table missing = unavailable', async () => {
    const x = deps({ rows: [row({ id: 'a', status: 'pending' }), row({ id: 'b', status: 'pending', dedupe_key: 'k2' })] })
    const r = await processOutbox(x.d)
    expect(r).toMatchObject({ unavailable: false, due: 2, outcomes: { delivered: 2 } })
    const gone = await processOutbox({ ...x.d, repo: { ...x.repo, listDueIds: async () => 'unavailable' } })
    expect(gone.unavailable).toBe(true)
    const lost = await processOutbox({ ...x.d, repo: { ...x.repo, listDueIds: async () => ['zz'], claim: async () => null } })
    expect(lost.outcomes.noop).toBe(1)
  })
  it('a time budget stops starting new rows', async () => {
    let t = NOW.getTime()
    const x = deps({ rows: [row({ id: 'a', status: 'pending' }), row({ id: 'b', status: 'pending', dedupe_key: 'k2' })], budgetMs: 1000, now: () => new Date((t += 2000)) })
    const r = await processOutbox(x.d)
    expect(r.outcomes.delivered).toBeLessThan(2)
  })
})

describe('supabase outbox repo: query shape', () => {
  it('list and claim filter on environment and the due expression; finalize only a delivering row', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'r1', attempts: 0, payload: {} }] })
    const repo = createSupabaseOutboxRepo(db)
    expect(await repo.listDueIds('production', NOW, 5)).toEqual(['r1'])
    await repo.claim('r1', 'production', NOW)
    await repo.finalize('r1', { status: 'delivered', attempts: 0, last_error: null })
    expect(opsOf(calls[0], 'eq')).toContainEqual(['environment', 'production'])
    expect(opsOf(calls[0], 'or')[0][0]).toBe(dueFilter(NOW))
    expect(opsOf(calls[1], 'update')[0][0]).toMatchObject({ status: 'delivering', claimed_at: NOW.toISOString() })
    expect(opsOf(calls[1], 'eq')).toContainEqual(['environment', 'production'])
    expect(opsOf(calls[2], 'eq')).toContainEqual(['status', 'delivering'])
    expect(opsOf(calls[2], 'update')[0][0]).toMatchObject({ claimed_at: null })
  })
  it('an unreadable outbox table is reported as unavailable, not thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ error: { code: '42P01', message: 'missing' } })
    expect(await createSupabaseOutboxRepo(db).listDueIds('production', NOW, 5)).toBe('unavailable')
  })
})
