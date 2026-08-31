/**
 * Guards the "token in code first, ACL flip second" contract.
 *
 * The whole safety argument for switching the Sanity datasets from public to
 * private rests on one property: shipping `SANITY_API_READ_TOKEN` support must
 * be a strict no-op until the variable actually exists. These tests pin that.
 *
 * `@sanity/client` is mocked so we can assert on the exact config object
 * `createClient` was handed, and the module under test is re-imported per case
 * because the token is read once at module scope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type SanityConfig = Record<string, unknown>

const createClientMock = vi.fn((config: SanityConfig) => ({ fetch: vi.fn(), config }))

vi.mock('@sanity/client', () => ({
  createClient: (config: SanityConfig) => createClientMock(config),
}))

const ORIGINAL_TOKEN = process.env.SANITY_API_READ_TOKEN

/** Fresh import of the client module, returning the config createClient saw. */
async function loadClient() {
  vi.resetModules()
  createClientMock.mockClear()
  const mod = await import('@/lib/sanity/client')
  const [firstCall] = createClientMock.mock.calls
  if (!firstCall) throw new Error('createClient was never called')
  const config: SanityConfig = firstCall[0]
  return { mod, config }
}

beforeEach(() => {
  delete process.env.SANITY_API_READ_TOKEN
})

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.SANITY_API_READ_TOKEN
  else process.env.SANITY_API_READ_TOKEN = ORIGINAL_TOKEN
})

describe('sanityClient — SANITY_API_READ_TOKEN absent (today, and every deploy before the ACL flip)', () => {
  it('constructs the client with NO token key at all', async () => {
    const { config } = await loadClient()
    // Not merely `undefined` — the key must be absent, so the request the
    // client builds is indistinguishable from the anonymous one we ship today.
    expect(config).not.toHaveProperty('token')
  })

  it('reports no read token', async () => {
    const { mod } = await loadClient()
    expect(mod.hasSanityReadToken).toBe(false)
  })

  it('keeps the rest of the config exactly as before', async () => {
    const { config } = await loadClient()
    expect(config.projectId).toBe('3n7t84j3')
    expect(config.dataset).toBe('production')
    expect(config.apiVersion).toBe('2026-05-21')
    // CDN must stay off — it caches empty GROQ results for fields that did not
    // exist at cache-warm time.
    expect(config.useCdn).toBe(false)
  })

  it('adds nothing to the config beyond the four pre-existing keys', async () => {
    const { config } = await loadClient()
    expect(Object.keys(config).sort()).toEqual(
      ['apiVersion', 'dataset', 'projectId', 'useCdn'].sort(),
    )
  })
})

describe('sanityClient — SANITY_API_READ_TOKEN present (after the token is deployed)', () => {
  it('passes the token through to createClient', async () => {
    process.env.SANITY_API_READ_TOKEN = 'sk-test-read-token'
    const { config } = await loadClient()
    expect(config.token).toBe('sk-test-read-token')
  })

  it('reports a read token', async () => {
    process.env.SANITY_API_READ_TOKEN = 'sk-test-read-token'
    const { mod } = await loadClient()
    expect(mod.hasSanityReadToken).toBe(true)
  })

  it('changes nothing else about the config', async () => {
    process.env.SANITY_API_READ_TOKEN = 'sk-test-read-token'
    const { config } = await loadClient()
    expect(config.projectId).toBe('3n7t84j3')
    expect(config.dataset).toBe('production')
    expect(config.apiVersion).toBe('2026-05-21')
    expect(config.useCdn).toBe(false)
    // No `perspective` override: adding one would change which documents come
    // back (drafts) and would not be a no-op. Deliberately left to the default.
    expect(config).not.toHaveProperty('perspective')
    expect(Object.keys(config).sort()).toEqual(
      ['apiVersion', 'dataset', 'projectId', 'token', 'useCdn'].sort(),
    )
  })

  it('treats an empty-string token as absent', async () => {
    // An env var declared-but-blank in a Vercel environment is a realistic
    // half-configured state; it must fall back to anonymous rather than send
    // an empty Authorization header.
    process.env.SANITY_API_READ_TOKEN = ''
    const { config, mod } = await loadClient()
    expect(config).not.toHaveProperty('token')
    expect(mod.hasSanityReadToken).toBe(false)
  })
})

describe('tenantClient.fetchForTenant — scope injection', () => {
  it('injects both projectSlug and tenantSlug', async () => {
    const { mod } = await loadClient()
    const fetchSpy = vi.fn().mockResolvedValue([])
    ;(mod.sanityClient as unknown as { fetch: unknown }).fetch = fetchSpy

    await mod.tenantClient('livener').fetchForTenant('*[_type == "page"]')

    expect(fetchSpy).toHaveBeenCalledWith('*[_type == "page"]', {
      projectSlug: 'livener-main',
      tenantSlug: 'livener',
    })
  })

  it('injects the URL tenant slug verbatim, not the project slug', async () => {
    const { mod } = await loadClient()
    const fetchSpy = vi.fn().mockResolvedValue([])
    ;(mod.sanityClient as unknown as { fetch: unknown }).fetch = fetchSpy

    // "abluo-the-tiny-cms" maps to project "abluo" — the two differ, so this
    // catches any accidental swap of the two values.
    await mod.tenantClient('abluo-the-tiny-cms').fetchForTenant('*[_type == "page"]')

    const params = fetchSpy.mock.calls[0][1]
    expect(params.tenantSlug).toBe('abluo-the-tiny-cms')
    expect(params.projectSlug).toBe('abluo')
  })

  it('preserves caller params and still wins on the scope keys', async () => {
    const { mod } = await loadClient()
    const fetchSpy = vi.fn().mockResolvedValue([])
    ;(mod.sanityClient as unknown as { fetch: unknown }).fetch = fetchSpy

    await mod.tenantClient('nologo').fetchForTenant('*[_id == $id]', {
      id: 'abc',
      projectSlug: 'attacker-supplied',
      tenantSlug: 'attacker-supplied',
    })

    expect(fetchSpy).toHaveBeenCalledWith('*[_id == $id]', {
      id: 'abc',
      projectSlug: 'nologo',
      tenantSlug: 'nologo',
    })
  })

  it('still refuses an empty tenant slug', async () => {
    const { mod } = await loadClient()
    expect(() => mod.tenantClient('')).toThrow(/tenantSlug is required/)
  })
})
