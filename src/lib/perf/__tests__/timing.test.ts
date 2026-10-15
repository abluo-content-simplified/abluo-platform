import { afterEach, describe, expect, it, vi } from 'vitest'
import { perfEnabled, span, stopwatch, traced } from '../timing'

describe('perf timing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('is on outside production, off in production unless forced', () => {
    expect(perfEnabled({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(perfEnabled({})).toBe(true)
    expect(perfEnabled({ VERCEL_ENV: 'production' })).toBe(false)
    expect(perfEnabled({ VERCEL_ENV: 'production', PERF_TIMING: '1' })).toBe(true)
    expect(perfEnabled({ VERCEL_ENV: 'preview', PERF_TIMING: '0' })).toBe(false)
  })

  it('span and stopwatch are pass-throughs outside a trace', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(span('x', async () => 42)).resolves.toBe(42)
    stopwatch('p')('a')
    expect(log).not.toHaveBeenCalled()
  })

  it('logs one line per trace with step names and never the values', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await traced('op.test', async () => {
      const lap = stopwatch('auth')
      lap('getUser')
      return span('read', async () => 'secret-value')
    })
    expect(out).toBe('secret-value')
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0][0])
    expect(line.startsWith('[perf] ')).toBe(true)
    const parsed = JSON.parse(line.slice(7))
    expect(parsed.op).toBe('op.test')
    expect(parsed.outcome).toBe('ok')
    expect(parsed.spans.map((s: [string, number]) => s[0])).toEqual(['auth.getUser', 'read'])
    expect(line).not.toContain('secret-value')
  })

  it('records and rethrows errors (redirect / notFound must propagate)', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(traced('op.fail', async () => { throw new Error('NEXT_REDIRECT') })).rejects.toThrow('NEXT_REDIRECT')
    expect(JSON.parse(String(log.mock.calls[0][0]).slice(7)).outcome).toBe('threw')
  })

  it('does not nest traces (inner traced runs inside the outer one)', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await traced('outer', () => traced('inner', async () => 1))
    expect(log).toHaveBeenCalledTimes(1)
  })
})
