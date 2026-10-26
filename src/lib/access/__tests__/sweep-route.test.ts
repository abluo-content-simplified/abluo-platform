/** ADR-040 B2.4 — the daily sweep route: secret-gated, harmless before migration 052. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AccessError } from '../model'
import { createFakeStore } from './fake-store'
import { createFakeFiles } from './fake-files'

let mode: 'ok' | 'not-installed' | 'boom' = 'ok'
vi.mock('@/lib/access/server', () => ({
  withSiteAccessStore: async (_r: string, fn: (s: unknown, f: unknown) => Promise<unknown>) => {
    if (mode === 'not-installed') throw new AccessError('unavailable', 'site access tables are not installed')
    if (mode === 'boom') throw new Error('db down')
    return fn(createFakeStore(), createFakeFiles())
  },
}))
const route = await import('@/app/api/cron/site-access-sweep/route')
const call = (auth?: string) => route.GET(new Request('https://x/api/cron/site-access-sweep', { headers: auth ? { authorization: auth } : {} }) as never)

beforeEach(() => { mode = 'ok'; process.env.CRON_SECRET = 'cron-secret-for-tests' })

describe('site-access sweep route', () => {
  it('refuses without the cron secret', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
  })
  it('runs the sweep with the secret', async () => {
    const r = await call('Bearer cron-secret-for-tests')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, expiredUploads: 0, removedObjects: 0 })
  })
  it('before migration 052 is applied: a quiet skip, not a daily error', async () => {
    mode = 'not-installed'
    expect(await (await call('Bearer cron-secret-for-tests')).json()).toMatchObject({ ok: true, skipped: expect.any(String) })
  })
  it('other failures are reported as failures', async () => {
    mode = 'boom'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call('Bearer cron-secret-for-tests')).status).toBe(500)
  })
})
