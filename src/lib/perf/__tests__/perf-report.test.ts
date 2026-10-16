import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPerf, span, traced, withPerf } from '../timing'
import { logPerf, timedAction } from '../client-log'

describe('perf report attached to results', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('adds op, ms, outcome and summed span ms inside a trace (non-production)', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await traced('op.x', async () => {
      await span('auth', async () => 1)
      await span('auth', async () => 2)
      return withPerf({ ok: true as const, rev: 'r1' })
    })
    expect(out.rev).toBe('r1')
    expect(out.perf?.op).toBe('op.x')
    expect(out.perf?.outcome).toBe('ok')
    expect(typeof out.perf?.ms).toBe('number')
    expect(Object.keys(out.perf!.spans)).toEqual(['auth'])
    expect(Object.keys(out.perf!).sort()).toEqual(['ms', 'op', 'outcome', 'spans'])
  })

  it('marks a failed result', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await traced('op.y', async () => withPerf({ ok: false as const, error: 'forbidden' }))
    expect(out.perf?.outcome).toBe('failed')
  })

  it('adds nothing in production (and the trace is not even opened)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('PERF_TIMING', '')
    const out = await traced('op.z', async () => withPerf({ ok: true as const }))
    expect(out).toEqual({ ok: true })
    expect('perf' in out).toBe(false)
    expect(currentPerf()).toBeUndefined()
  })

  it('adds nothing outside a trace', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(withPerf({ ok: true })).toEqual({ ok: true })
  })
})

describe('client log helper', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is silent without a perf field', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    logPerf('x', 10, undefined)
    await expect(timedAction('x', async () => ({ ok: true }))).resolves.toEqual({ ok: true })
    expect(log).not.toHaveBeenCalled()
  })

  it('logs client ms, server ms and the gap, and returns the result untouched', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    logPerf('catalogue.patch', 300, { op: 'catalogue.patch', ms: 200, outcome: 'ok', spans: { auth: 50 } })
    expect(log).toHaveBeenCalledWith('[perf]', 'catalogue.patch client=300ms server=200ms gap=100ms outcome=ok', { auth: 50 })
    const r = { ok: true, perf: { op: 'o', ms: 1, outcome: 'ok', spans: {} } }
    await expect(timedAction('o', async () => r)).resolves.toBe(r)
    expect(log).toHaveBeenCalledTimes(2)
  })
})
