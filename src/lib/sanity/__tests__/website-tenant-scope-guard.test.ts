/**
 * Finding I-9 — the public-website read path enforces tenant scoping at
 * runtime, not by convention.
 *
 * Before this guard, `tenantClient(slug).fetchForTenant(query, params)`
 * injected `projectSlug` and `tenantSlug` as bound GROQ parameters and then
 * ran whatever query it was given. A query that never MENTIONS `$projectSlug`
 * was handed the parameter and silently ignored it — returning every tenant's
 * documents from the shared dataset and rendering another client's content on
 * this client's website. The only thing preventing that was
 * `query-tenant-scope.test.ts`, a static check over the `queries.ts` catalogue
 * that an inline query string at a call site would sail straight past.
 *
 * These tests pin four things:
 *   1. a scoped query passes through untouched (params still injected);
 *   2. an unscoped query is caught;
 *   3. the audited exempt path (`fetchDesignSystemById`) still runs;
 *   4. the dashboard chokepoint's behaviour is unchanged by the refactor that
 *      gave both paths one shared detector.
 *
 * `@sanity/client` is mocked so nothing hits live Sanity.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

type SanityConfig = Record<string, unknown>

const fetchMock = vi.fn()
const createClientMock = vi.fn((config: SanityConfig) => ({ fetch: fetchMock, config }))

vi.mock('@sanity/client', () => ({
  createClient: (config: SanityConfig) => createClientMock(config),
}))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ── The detector itself ──────────────────────────────────────────────────────

describe('findTenantScopeViolation', () => {
  it('passes a query that parameterizes on $projectSlug', async () => {
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    expect(
      findTenantScopeViolation(
        '*[_type == "page" && projectSlug == $projectSlug][0]',
        'tenantClient.fetchForTenant',
      ),
    ).toBeNull()
  })

  it('catches a query with no $projectSlug at all', async () => {
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    const violation = findTenantScopeViolation('*[_type == "page"][0]', 'label')
    expect(violation?.kind).toBe('missing-project-slug')
    expect(violation?.message).toContain('label: query must reference $projectSlug')
  })

  it('catches the shape that actually leaked — a raw _id lookup', async () => {
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    // Ids from an editor's manual-selection list carry no scope of their own;
    // this is the exact shape that shipped twice in the listing queries.
    expect(findTenantScopeViolation('*[_id in $ids]', 'label')?.kind).toBe(
      'missing-project-slug',
    )
  })

  it('catches template-literal interpolation before the missing-scope check', async () => {
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    // Interpolation wins even when $projectSlug is present: an inlined tenant
    // identifier is a worse problem than a missing parameter.
    const violation = findTenantScopeViolation(
      '*[projectSlug == $projectSlug && _id == "${id}"]',
      'label',
    )
    expect(violation?.kind).toBe('interpolation')
  })

  it('prefixes the caller label so the two chokepoints stay distinguishable', async () => {
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    expect(findTenantScopeViolation('*[_type == "page"]', 'A')?.message).toMatch(/^A: /)
    expect(findTenantScopeViolation('*[_type == "page"]', 'B')?.message).toMatch(/^B: /)
  })
})

// ── throw-in-dev / warn-elsewhere ────────────────────────────────────────────

describe('tenantScopeEnforcement', () => {
  it('throws in development and warns everywhere else', async () => {
    const { tenantScopeEnforcement } = await import('@/lib/sanity/client')
    expect(tenantScopeEnforcement('development')).toBe('throw')
    expect(tenantScopeEnforcement('production')).toBe('warn')
    expect(tenantScopeEnforcement('test')).toBe('warn')
    expect(tenantScopeEnforcement(undefined)).toBe('warn')
  })
})

// ── fetchForTenant ───────────────────────────────────────────────────────────

describe('fetchForTenant enforces scoping at runtime', () => {
  it('lets a scoped query through and still injects both scope params', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { tenantClient } = await import('@/lib/sanity/client')
    const query = '*[_type == "page" && projectSlug == $projectSlug][0]'

    await tenantClient(asUrlProjectSegment('livener')).fetchForTenant(query, { locale: 'it' })

    expect(fetchMock).toHaveBeenCalledWith(query, {
      locale: 'it',
      projectSlug: 'livener-main',
      tenantSlug: 'livener',
    })
  })

  it('throws on an unscoped query in development, before reaching Sanity', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { tenantClient } = await import('@/lib/sanity/client')

    // Throws synchronously, exactly like the dashboard chokepoint does — the
    // call never becomes a pending promise.
    expect(() => tenantClient(asUrlProjectSegment('livener')).fetchForTenant('*[_type == "page"][0]')).toThrow(
      /must reference \$projectSlug/,
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the tenant, the project and the query in the development throw', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { tenantClient } = await import('@/lib/sanity/client')

    // A message that does not identify the query is unactionable in a codebase
    // with a hundred of them.
    // Use a segment whose projectSlug DIFFERS from it (`livener` →
    // `livener-main`), so the message is proved to name both namespaces and not
    // one value twice. (This used to use the platform site; Step 1 of
    // `src/lib/tenancy/RENAME.md` made that pair identical.)
    expect(() => tenantClient(asUrlProjectSegment('livener')).fetchForTenant('*[_id in $ids]')).toThrow(
      /tenantSlug=livener projectSlug=livener-main[^]*_id in \$ids/,
    )
  })

  it('in production warns with full detail and STILL RUNS the query', async () => {
    // The load-bearing half of the trade-off: a false positive from this
    // substring check must not black out a live client website.
    vi.stubEnv('NODE_ENV', 'production')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tenantClient } = await import('@/lib/sanity/client')

    await tenantClient(asUrlProjectSegment('livener')).fetchForTenant('*[_type == "page"][0]')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledTimes(1)
    const logged = String(consoleError.mock.calls[0][0])
    expect(logged).toContain('[tenant-scope]')
    expect(logged).toContain('tenantSlug=livener')
    expect(logged).toContain('projectSlug=livener-main')
    expect(logged).toContain('*[_type == "page"][0]')
  })

  it('does not warn in production for a properly scoped query', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tenantClient } = await import('@/lib/sanity/client')

    await tenantClient(asUrlProjectSegment('livener')).fetchForTenant('*[projectSlug == $projectSlug][0]')

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('every exported query in the catalogue passes the runtime guard', async () => {
    // Ties the runtime guard to the real query catalogue: if a query that the
    // website actually issues would trip this guard, that is a production
    // outage in development and a log flood in production. The three known
    // exemptions are projection FRAGMENTS, never passed to fetchForTenant as
    // whole queries — see ALLOWED_WITHOUT_PROJECT_SCOPE in
    // query-tenant-scope.test.ts.
    const FRAGMENTS = ['CTA_FIELDS', 'PAGE_SECTIONS_PROJECTION', 'DS_FIELDS_SELECTION']
    const { findTenantScopeViolation } = await import('@/lib/sanity/client')
    const queries = await import('@/lib/sanity/queries')

    const tripped = Object.entries(queries)
      .filter(([name, value]) => typeof value === 'string' && !FRAGMENTS.includes(name))
      .filter(([, value]) => findTenantScopeViolation(value as string, 'x') !== null)
      .map(([name]) => name)

    expect(tripped).toEqual([])
  })
})

// ── The audited exemption ────────────────────────────────────────────────────

describe('fetchDesignSystemById — the one audited unscoped website read', () => {
  it('is recorded in UNSCOPED_READ_EXEMPTIONS with a substantive reason', async () => {
    const { UNSCOPED_READ_EXEMPTIONS } = await import('@/lib/sanity/client')
    expect(Object.keys(UNSCOPED_READ_EXEMPTIONS)).toEqual(['fetchDesignSystemById'])
    // An unexplained exemption is how the next leak gets waved through.
    expect(UNSCOPED_READ_EXEMPTIONS.fetchDesignSystemById.length).toBeGreaterThan(20)
  })

  it('still fetches by _id with no projectSlug filter, in development, without throwing', async () => {
    // The design-system inheritance resolver follows `parentDesignSystem->`
    // across projects on purpose. If this throws, every website that inherits
    // a theme goes down in dev.
    vi.stubEnv('NODE_ENV', 'development')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ _id: 'ds-parent' })
    const { fetchDesignSystemById } = await import('@/lib/sanity/client')

    await expect(fetchDesignSystemById('ds-parent')).resolves.toEqual({ _id: 'ds-parent' })

    const [query, params] = fetchMock.mock.calls[0]
    expect(query).toContain('_id == $id')
    expect(query).not.toContain('$projectSlug')
    expect(params).toEqual({ id: 'ds-parent' })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
