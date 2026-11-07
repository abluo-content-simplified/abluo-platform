import { describe, expect, it } from 'vitest'
import { ok, fail } from '../../server/errors'
import { hashToken, mintManagementToken } from './helpers'
import { LINK_RATE, lookupBookingLink, lookupPassLink } from '../link-guard'
import { bookingRow, makeStore, P, passRow } from '../../service/__tests__/fake-store'

const IP = 'a'.repeat(64)
const TOKEN = mintManagementToken(3)

function guarded(over: Parameters<typeof makeStore>[0] = {}, attempt: { allowed: boolean } = { allowed: true }) {
  const s = makeStore(over)
  const log: Array<[string, unknown[]]> = []
  s.store.reserveLinkAttempt = (async (...a: unknown[]) => {
    log.push(['reserve', a])
    return ok({ allowed: attempt.allowed, attemptId: attempt.allowed ? 7 : null, retryAfterSeconds: attempt.allowed ? 0 : 900 })
  }) as never
  s.store.finishLinkAttempt = (async (...a: unknown[]) => { log.push(['finish', a]); return ok(true as const) }) as never
  return { ...s, log }
}

describe('lookupBookingLink', () => {
  it('finds the booking of this project, reserves an attempt and marks it succeeded', async () => {
    const g = guarded()
    const r = await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: IP })
    expect(r).toMatchObject({ kind: 'ok', value: { id: 'b1' } })
    expect(g.called('getBookingByTokenHash')[0].args[0]).toBe(hashToken(TOKEN))
    expect(g.log[0]).toEqual(['reserve', [P, IP, LINK_RATE.windowSeconds, LINK_RATE.perIp]])
    expect(g.log[1]).toEqual(['finish', [7, true]])
  })

  it('a booking of ANOTHER project is "invalid", exactly like an unknown token (and the attempt counts as failed)', async () => {
    const other = guarded({ bookingByToken: bookingRow({ projectId: 'other-project' }) })
    const unknown = guarded({ bookingByToken: null })
    const a = await lookupBookingLink(other.store, { projectId: P, token: TOKEN, ipHash: IP })
    const b = await lookupBookingLink(unknown.store, { projectId: P, token: TOKEN, ipHash: IP })
    expect(a).toEqual({ kind: 'invalid' })
    expect(b).toEqual(a)
    expect(other.log[1]).toEqual(['finish', [7, false]])
  })

  it('an anonymised booking is invalid', async () => {
    const g = guarded({ bookingByToken: bookingRow({ anonymisedAt: '2026-01-01T00:00:00.000Z' }) })
    expect(await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: IP })).toEqual({ kind: 'invalid' })
  })

  it.each([['short'], [''], [undefined], [42], ['has spaces and is long enough to pass the length check!!']])(
    'malformed token %j: invalid without touching the database',
    async (token) => {
      const g = guarded()
      expect(await lookupBookingLink(g.store, { projectId: P, token, ipHash: IP })).toEqual({ kind: 'invalid' })
      expect(g.calls).toHaveLength(0)
      expect(g.log).toHaveLength(0)
    },
  )

  it('rate limited: "limited", and the token is never looked up', async () => {
    const g = guarded({}, { allowed: false })
    const r = await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: IP })
    expect(r).toEqual({ kind: 'limited', retryAfterSeconds: 900 })
    expect(g.called('getBookingByTokenHash')).toHaveLength(0)
  })

  it('no address salt configured: unavailable (fail closed), nothing is read', async () => {
    const g = guarded()
    expect(await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: null })).toEqual({ kind: 'unavailable' })
    expect(g.log).toHaveLength(0)
  })

  it('066 missing / database down: unavailable, never "invalid"', async () => {
    const g = guarded()
    g.store.reserveLinkAttempt = (async () => fail({ kind: 'unavailable' })) as never
    expect(await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: IP })).toEqual({ kind: 'unavailable' })
    const h = guarded()
    h.store.getBookingByTokenHash = (async () => fail({ kind: 'unavailable' })) as never
    expect(await lookupBookingLink(h.store, { projectId: P, token: TOKEN, ipHash: IP })).toEqual({ kind: 'unavailable' })
  })

  it('a store that throws is unavailable, and a failing finish call does not break the answer', async () => {
    const g = guarded()
    g.store.getBookingByTokenHash = (async () => { throw new Error('boom') }) as never
    expect(await lookupBookingLink(g.store, { projectId: P, token: TOKEN, ipHash: IP })).toEqual({ kind: 'unavailable' })
    const h = guarded()
    h.store.finishLinkAttempt = (async () => { throw new Error('boom') }) as never
    expect((await lookupBookingLink(h.store, { projectId: P, token: TOKEN, ipHash: IP })).kind).toBe('ok')
  })
})

describe('lookupPassLink', () => {
  it('finds the pass; wrong project / unknown / anonymised are all invalid', async () => {
    expect((await lookupPassLink(guarded().store, { projectId: P, token: TOKEN, ipHash: IP })).kind).toBe('ok')
    for (const passByToken of [passRow({ projectId: 'other' }), null, passRow({ anonymisedAt: '2026-01-01T00:00:00.000Z' })]) {
      expect(await lookupPassLink(guarded({ passByToken }).store, { projectId: P, token: TOKEN, ipHash: IP })).toEqual({ kind: 'invalid' })
    }
  })

  it('a cancelled pass is still found (the page says so)', async () => {
    const r = await lookupPassLink(guarded({ passByToken: passRow({ status: 'cancelled' }) }).store, { projectId: P, token: TOKEN, ipHash: IP })
    expect(r).toMatchObject({ kind: 'ok', value: { status: 'cancelled' } })
  })
})
