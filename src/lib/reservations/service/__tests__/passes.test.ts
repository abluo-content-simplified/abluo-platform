import { describe, expect, it } from 'vitest'
import { signUp, withdraw, type PassAttendanceInput } from '../passes'
import { mintToken } from '../types'
import { counterBytes, makeDeps, makeStore, O1, P, passRow, REF, settings, TZ, hash } from './fake-store'

const OPT_IN = settings({ passSignUp: 'opt_in', signUpOpensDaysBefore: 7, answerChangeUntilHoursBefore: 2 })
const tok = mintToken({ randomBytes: counterBytes(9) })
const at = (iso: string) => ({ occurrenceId: O1, startsAt: iso, ownerType: 'course' as const, ownerPublicId: 'c-yoga' })
const input = (iso: string, over: Partial<PassAttendanceInput> = {}): PassAttendanceInput => ({
  projectId: P, passToken: tok.token, occurrenceId: O1, session: at(iso), target: REF, timeZone: TZ, ...over,
})
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code)
// NOW = 2026-11-07T10:00:00Z
const IN_3_DAYS = '2026-11-10T18:00:00Z'

describe('signUp', () => {
  it('opt_in + inside the window: calls the store with the pass id from the token', async () => {
    const s = makeStore({ settings: OPT_IN })
    const r = await signUp(input(IN_3_DAYS), makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { allocationId: 'al1' } })
    expect(s.called('getPassByTokenHash')[0].args[0]).toBe(tok.hash)
    expect(s.called('passAttend')[0].args.slice(0, 3)).toEqual([P, 'pass1', O1])
  })
  it("mode 'off' -> sign_up_not_needed (and no store call)", async () => {
    const s = makeStore({ settings: settings({ passSignUp: 'off' }) })
    expect(code(await signUp(input(IN_3_DAYS), makeDeps(s.store)))).toBe('sign_up_not_needed')
    expect(s.called('passAttend')).toHaveLength(0)
  })
  it('a session override can switch the mode on for one class', async () => {
    const s = makeStore({ settings: settings({ passSignUp: 'off' }) })
    const i = input(IN_3_DAYS); i.session.rulesOverride = { passSignUp: 'opt_in' }
    expect(code(await signUp(i, makeDeps(s.store)))).toBe('ok')
  })
  it('window: not open yet / open at the opening instant / deadline inclusive / closed after', async () => {
    const d = (iso: string) => signUp(input(iso), makeDeps(makeStore({ settings: OPT_IN }).store))
    expect(code(await d('2026-11-20T18:00:00Z'))).toBe('sign_up_not_open_yet')
    expect(code(await d('2026-11-14T10:00:00Z'))).toBe('ok')              // exactly 7 days before
    expect(code(await d('2026-11-14T10:00:01Z'))).toBe('sign_up_not_open_yet')
    expect(code(await d('2026-11-07T12:00:00Z'))).toBe('ok')              // exactly 2 h before
    expect(code(await d('2026-11-07T11:59:59Z'))).toBe('sign_up_closed')
  })
  it('wrong project, unknown token, inactive pass, outside validity or scope', async () => {
    const d = (store: ReturnType<typeof makeStore>, over: Partial<PassAttendanceInput> = {}) => signUp(input(IN_3_DAYS, over), makeDeps(store.store))
    expect(code(await d(makeStore({ settings: OPT_IN, passByToken: passRow({ projectId: 'other' }) })))).toBe('not_found')
    expect(code(await d(makeStore({ settings: OPT_IN, passByToken: null })))).toBe('not_found')
    expect(code(await d(makeStore({ settings: OPT_IN }), { passToken: 'short' }))).toBe('not_found')
    expect(code(await d(makeStore({ settings: OPT_IN, passByToken: passRow({ status: 'cancelled' }) })))).toBe('pass_not_active')
    expect(code(await d(makeStore({ settings: OPT_IN, passByToken: passRow({ validTo: '2026-11-09' }) })))).toBe('pass_does_not_cover')
    expect(code(await d(makeStore({ settings: OPT_IN, passByToken: passRow({ scope: 'courses', scopeOwnerIds: ['c-other'] }) })))).toBe('pass_does_not_cover')
  })
  it('database refusals become codes (no entries, full)', async () => {
    const s = makeStore({ settings: OPT_IN })
    s.store.passAttend = (async () => ({ ok: false, error: { kind: 'refused', code: 'no_entries_left' } })) as never
    expect(code(await signUp(input(IN_3_DAYS), makeDeps(s.store)))).toBe('no_entries_left')
  })
  it('a pass id works for the dashboard without a token lookup', async () => {
    const s = makeStore({ settings: OPT_IN })
    expect(code(await signUp(input(IN_3_DAYS, { passToken: undefined, passId: 'pass9' }), makeDeps(s.store)))).toBe('ok')
    expect(s.called('getPassByTokenHash')).toHaveLength(0)
    expect(s.called('passAttend')[0].args[1]).toBe('pass9')
  })
})

describe('withdraw', () => {
  it('before the change deadline the entry is returned', async () => {
    const s = makeStore({ settings: OPT_IN })
    const r = await withdraw(input('2026-11-07T12:00:00Z'), makeDeps(s.store)) // exactly 2 h before
    expect(r).toMatchObject({ ok: true, value: { released: true, entryReturned: true, afterDeadline: false } })
    expect((s.called('passWithdraw')[0].args[3] as { returnEntry: boolean }).returnEntry).toBe(true)
  })
  it('after the deadline the place is released but the entry is not returned', async () => {
    const s = makeStore({ settings: OPT_IN })
    const r = await withdraw(input('2026-11-07T11:59:59Z'), makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { released: true, entryReturned: false, afterDeadline: true } })
    expect((s.called('passWithdraw')[0].args[3] as { returnEntry: boolean }).returnEntry).toBe(false)
  })
  it('after the session started: refused', async () => {
    const s = makeStore({ settings: OPT_IN })
    expect(code(await withdraw(input('2026-11-07T09:00:00Z'), makeDeps(s.store)))).toBe('session_started')
    expect(s.called('passWithdraw')).toHaveLength(0)
  })
  it('hash helper sanity', () => expect(hash('x')).toHaveLength(64))
})
