import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGoogleAccessToken, GOOGLE_ANALYTICS_SCOPES, GOOGLE_SETUP_SCOPES, resetGoogleTokenCache, tokenCacheKey } from '@/lib/analytics/google-auth'
import { integrationConfigTypeName, integrationValuesTypeName } from '@/lib/integrations/schema'
import googleAnalytics from '@/lib/integrations/manifests/google-analytics'
import googleSearchConsole from '@/lib/integrations/manifests/google-search-console'
import { analyticsIdsFrom } from '@/lib/analytics/config'
import { resolveCanonicalSiteUrl } from '../site-url'
import { connectSearchConsole, metaTokenContent, ownersFromEnv, pageHasVerificationMeta, SITE_VERIFICATION_BASE, WEBMASTERS_BASE } from '../search-console-setup'
import { ANALYTICS_ADMIN_BASE, analyticsAccountId, setupAnalytics } from '../analytics-setup'
import { INTEGRATION_TYPES, withIntegration, type IntegrationEntry, type SanityPort } from '../sanity-config'
import { googleCardState } from '../state'
import { GoogleSetupError } from '../errors'

// ── Fakes ─────────────────────────────────────────────────────────────────────

const SA = 'abluo@proj.iam.gserviceaccount.com'
const ENV = {
  GOOGLE_ANALYTICS_SA_EMAIL: SA,
  GOOGLE_ANALYTICS_SA_PRIVATE_KEY: 'unused-because-getToken-is-injected',
  GOOGLE_ANALYTICS_ACCOUNT_ID: '123456',
  GOOGLE_SEARCH_CONSOLE_OWNERS: 'Tom@tmz.it, ops@abluo.app',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
const redirect = (to: string, status = 301) => new Response(null, { status, headers: { location: to } })

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined
type Call = { method: string; url: string; body: unknown }

/** A fetch that answers from handlers in order and records every call. Unhandled → test failure. */
function fakeFetch(handlers: Handler[]) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ method: init.method ?? 'GET', url: url.toString(), body: init.body ? JSON.parse(String(init.body)) : undefined })
    for (const h of handlers) {
      const r = await h(url, init)
      if (r) return r
    }
    throw new Error(`unexpected fetch ${init.method ?? 'GET'} ${url}`)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

type Doc = Record<string, unknown> & { _id: string; _rev: string }

/** An in-memory Sanity that understands the two reads and raw patch mutations. */
function fakeSanity(docs: Doc[]) {
  const store = new Map(docs.map((d) => [d._id, structuredClone(d)]))
  const mutations: Record<string, unknown>[][] = []
  let rev = 0
  const port: SanityPort = {
    fetch: async <T,>(query: string, params: Record<string, unknown>): Promise<T> => {
      if (query.includes('"projects"')) {
        const live = [...store.values()].filter((d) => !d._id.startsWith('drafts.') && d.projectSlug === params.slug)
        return { projects: live.filter((d) => d._type === 'project'), siteConfigs: live.filter((d) => d._type === 'siteConfig') } as T
      }
      return (params.ids as string[]).map((id) => store.get(id)).filter(Boolean) as T
    },
    mutate: async (ms) => {
      mutations.push(ms)
      for (const m of ms) {
        const p = (m as { patch: { id: string; ifRevisionID: string; set: Record<string, unknown> } }).patch
        const d = store.get(p.id)
        if (!d || d._rev !== p.ifRevisionID) throw new Error(`revision mismatch on ${p.id}`)
        store.set(p.id, { ...d, ...structuredClone(p.set), _rev: `r${++rev}` })
      }
    },
  }
  return { port, store, mutations }
}

const projectDoc = (extra: Record<string, unknown> = {}): Doc => ({ _id: 'proj-1', _rev: 'p0', _type: 'project', projectSlug: 'rossi', ...extra })
const siteConfigDoc = (extra: Record<string, unknown> = {}): Doc => ({ _id: 'site-1', _rev: 's0', _type: 'siteConfig', projectSlug: 'rossi', ...extra })

const SITE = 'https://www.rossi.it/'
const RES_ID = encodeURIComponent(SITE)

/** example: rossi.it → 301 www → 307 /it/ → 200 */
const domainRedirects: Handler = (url, init) => {
  if (init.redirect !== 'manual') return undefined
  if (url.host === 'rossi.it') return redirect('https://www.rossi.it/')
  if (url.host === 'www.rossi.it' && url.pathname === '/') return redirect('/it/', 307)
  if (url.host === 'www.rossi.it') return html('<html></html>')
  return undefined
}

const tick = () => {
  let t = 0
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)) }
}

// ── Canonical URL ─────────────────────────────────────────────────────────────

describe('resolveCanonicalSiteUrl', () => {
  it('follows redirects (manual) and keeps only the served host, with a trailing /', async () => {
    const { fetch, calls } = fakeFetch([domainRedirects])
    expect(await resolveCanonicalSiteUrl('rossi.it', { fetch })).toBe(SITE)
    expect(calls.map((c) => c.url)).toEqual(['https://rossi.it/', 'https://www.rossi.it/', 'https://www.rossi.it/it/'])
  })

  it('stops after 3 hops', async () => {
    const { fetch, calls } = fakeFetch([(url) => redirect(`https://h${Number(url.host.slice(1, 2)) + 1}.example.com/`)])
    expect(await resolveCanonicalSiteUrl('h1.example.com', { fetch })).toBe('https://h4.example.com/')
    expect(calls).toHaveLength(3)
  })

  it('no domain → no_domain; no answer → site_unreachable', async () => {
    await expect(resolveCanonicalSiteUrl(null)).rejects.toMatchObject({ code: 'no_domain' })
    const fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }) as unknown as typeof globalThis.fetch
    await expect(resolveCanonicalSiteUrl('nowhere.it', { fetch })).rejects.toMatchObject({ code: 'site_unreachable' })
  })
})

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('META token content, the meta-tag check, owners and account parsing', () => {
    expect(metaTokenContent('<meta name="google-site-verification" content="abc-123_X" />')).toBe('abc-123_X')
    expect(metaTokenContent('plain')).toBe('plain')
    expect(pageHasVerificationMeta('<head><meta content="T1" name="google-site-verification"/></head>', 'T1')).toBe(true)
    expect(pageHasVerificationMeta('<meta name="google-site-verification" content="OLD"/>', 'T1')).toBe(false)
    expect(ownersFromEnv(ENV)).toEqual(['tom@tmz.it', 'ops@abluo.app'])
    expect(ownersFromEnv({})).toEqual([])
    expect(analyticsAccountId({ GOOGLE_ANALYTICS_ACCOUNT_ID: 'accounts/42' })).toBe('42')
    expect(analyticsAccountId({})).toBeNull()
  })

  it('integration type names match the generated schema', () => {
    expect(INTEGRATION_TYPES['google-analytics']).toEqual({ config: integrationConfigTypeName(googleAnalytics), values: integrationValuesTypeName(googleAnalytics) })
    expect(INTEGRATION_TYPES['google-search-console']).toEqual({
      config: integrationConfigTypeName(googleSearchConsole),
      values: integrationValuesTypeName(googleSearchConsole),
    })
  })

  it('withIntegration adds, merges (keeping other entries and values) and reports no-ops', () => {
    const other: IntegrationEntry = { _key: 'k1', _type: 'metaPixelIntegrationConfig', integrationId: 'meta-pixel', enabled: true, values: { pixelId: '1' } }
    const added = withIntegration([other], 'google-search-console', { siteUrl: SITE })!
    expect(added).toEqual([
      other,
      {
        _key: 'integration-google-search-console',
        _type: 'googleSearchConsoleIntegrationConfig',
        integrationId: 'google-search-console',
        enabled: true,
        values: { _type: 'googleSearchConsoleIntegrationValues', siteUrl: SITE },
      },
    ])
    expect(withIntegration(added, 'google-search-console', { siteUrl: SITE })).toBeNull()
    const ga = withIntegration([{ _key: 'g', integrationId: 'google-analytics', enabled: false, values: { measurementId: 'G-OLD' } }], 'google-analytics', {
      ga4PropertyId: '123456789',
    })!
    expect(ga[0]).toMatchObject({ _key: 'g', enabled: true, values: { measurementId: 'G-OLD', ga4PropertyId: '123456789' } })
  })

  it('card state from stored settings', () => {
    expect(googleCardState(null, null)).toMatchObject({ analytics: { state: 'not_set_up' }, searchConsole: { state: 'not_set_up' } })
    expect(googleCardState(null, 'tok').searchConsole.state).toBe('waiting_for_site')
    const configs = withIntegration(withIntegration([], 'google-analytics', { measurementId: 'G-AB12', ga4PropertyId: '123456789' }), 'google-search-console', {
      siteUrl: SITE,
    })
    expect(googleCardState(configs, 'tok')).toMatchObject({ analytics: { state: 'connected' }, searchConsole: { state: 'connected', siteUrl: SITE } })
  })
})

// ── Token cache per scope set ─────────────────────────────────────────────────

describe('google-auth scope sets', () => {
  beforeEach(() => resetGoogleTokenCache())
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const env = { GOOGLE_ANALYTICS_SA_EMAIL: SA, GOOGLE_ANALYTICS_SA_PRIVATE_KEY: privateKey }

  it('caches one token per scope set; order does not matter; the setup token asks for the write scopes', async () => {
    let n = 0
    const fetch = vi.fn(async () => json({ access_token: `tok-${++n}`, expires_in: 3600 })) as unknown as typeof globalThis.fetch
    expect(await getGoogleAccessToken({ env, fetch })).toBe('tok-1')
    expect(await getGoogleAccessToken({ env, fetch, scopes: GOOGLE_SETUP_SCOPES })).toBe('tok-2')
    expect(await getGoogleAccessToken({ env, fetch, scopes: [...GOOGLE_SETUP_SCOPES].reverse() })).toBe('tok-2')
    expect(await getGoogleAccessToken({ env, fetch, scopes: GOOGLE_ANALYTICS_SCOPES })).toBe('tok-1')
    expect(fetch).toHaveBeenCalledTimes(2)
    const claims = JSON.parse(Buffer.from(String(new URLSearchParams(String((vi.mocked(fetch).mock.calls[1] as unknown as [string, RequestInit])[1].body)).get('assertion')).split('.')[1], 'base64url').toString())
    expect(claims.scope.split(' ')).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/siteverification',
        'https://www.googleapis.com/auth/webmasters',
        'https://www.googleapis.com/auth/analytics.edit',
        'https://www.googleapis.com/auth/analytics.readonly',
      ]),
    )
    expect(tokenCacheKey(SA, ['b', 'a', 'a'])).toBe(tokenCacheKey(SA, ['a', 'b']))
  })
})

// ── Search Console ────────────────────────────────────────────────────────────

const TOKEN_TAG = '<meta name="google-site-verification" content="TOK123" />'

function searchConsoleGoogle(opts: { verified?: string[] | null; tagAfterPolls?: number | null; verifyStatus?: number } = {}) {
  let polls = 0
  const handlers: Handler[] = [
    domainRedirects,
    (url, init) => {
      if (url.toString() === `${SITE_VERIFICATION_BASE}/token` && init.method === 'POST') return json({ method: 'META', token: TOKEN_TAG })
      if (url.toString() === `${SITE_VERIFICATION_BASE}/webResource/${RES_ID}` && (init.method ?? 'GET') === 'GET')
        return opts.verified ? json({ id: RES_ID, site: { type: 'SITE', identifier: SITE }, owners: opts.verified }) : json({ error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } }, 404)
      if (url.toString() === `${SITE_VERIFICATION_BASE}/webResource?verificationMethod=META` && init.method === 'POST')
        return opts.verifyStatus
          ? json({ error: { code: opts.verifyStatus, message: 'The necessary verification token could not be found on your site.', status: 'INVALID_ARGUMENT' } }, opts.verifyStatus)
          : json({ id: RES_ID, site: { type: 'SITE', identifier: SITE }, owners: [SA] })
      if (url.toString() === `${SITE_VERIFICATION_BASE}/webResource/${RES_ID}` && init.method === 'PUT') return json({ id: RES_ID, owners: (JSON.parse(String(init.body)) as { owners: string[] }).owners })
      if (url.toString() === `${WEBMASTERS_BASE}/sites/${encodeURIComponent(SITE)}` && init.method === 'PUT') return new Response(null, { status: 204 })
      return undefined
    },
    (url) => {
      if (url.host !== 'www.rossi.it' || !url.searchParams.has('abluo-verify')) return undefined
      polls++
      const live = opts.tagAfterPolls != null && polls >= opts.tagAfterPolls
      return html(`<html><head>${live ? '<meta name="google-site-verification" content="TOK123"/>' : ''}</head></html>`)
    },
  ]
  return handlers
}

describe('connectSearchConsole', () => {
  it('happy path: token → Sanity (published + draft) → poll → verify → owners → sites.add → integration', async () => {
    const { fetch, calls } = fakeFetch(searchConsoleGoogle({ tagAfterPolls: 2 }))
    const sanity = fakeSanity([projectDoc(), siteConfigDoc(), siteConfigDoc({ _id: 'drafts.site-1', _rev: 'd0', siteName: 'draft edit' })])
    const clock = tick()
    const getToken = vi.fn(async () => 'setup-token')

    const out = await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: ENV, fetch, getToken, sanity: sanity.port, ...clock })

    expect(out).toEqual({ state: 'connected', values: { siteUrl: SITE }, changed: ['sanity.googleSiteVerification', 'google.verified', 'google.owners', 'sanity.integration'] })
    const google = calls.filter((c) => c.url.startsWith('https://www.googleapis.com/'))
    expect(google.map((c) => `${c.method} ${c.url.replace('https://www.googleapis.com', '')}`)).toEqual([
      'POST /siteVerification/v1/token',
      `GET /siteVerification/v1/webResource/${RES_ID}`,
      'POST /siteVerification/v1/webResource?verificationMethod=META',
      `PUT /siteVerification/v1/webResource/${RES_ID}`,
      `PUT /webmasters/v3/sites/${encodeURIComponent(SITE)}`,
    ])
    expect(google[0].body).toEqual({ site: { type: 'SITE', identifier: SITE }, verificationMethod: 'META' })
    expect(google[3].body).toEqual({ site: { type: 'SITE', identifier: SITE }, owners: [SA, 'tom@tmz.it', 'ops@abluo.app'] })
    // Sanity: the token on the published siteConfig AND its open draft, in one transaction; no new draft.
    expect(sanity.mutations[0].map((m) => (m as { patch: { id: string } }).patch.id)).toEqual(['site-1', 'drafts.site-1'])
    expect(sanity.store.get('site-1')?.googleSiteVerification).toBe('TOK123')
    expect(sanity.store.get('drafts.site-1')).toMatchObject({ googleSiteVerification: 'TOK123', siteName: 'draft edit' })
    expect(sanity.store.has('drafts.proj-1')).toBe(false)
    expect(analyticsIdsFrom(sanity.store.get('proj-1')?.integrationConfigs as never).gscSiteUrl).toBe(SITE)
    // Polled until the tag appeared, sleeping between polls.
    expect(clock.sleep).toHaveBeenCalledTimes(1)
    expect(getToken).toHaveBeenCalledTimes(1)
  })

  it('site not serving the tag → waiting_for_site; never verifies; token kept for the retry', async () => {
    const { fetch, calls } = fakeFetch(searchConsoleGoogle({ tagAfterPolls: null }))
    const sanity = fakeSanity([projectDoc(), siteConfigDoc()])
    const clock = tick()
    const out = await connectSearchConsole(
      { slug: 'rossi', customDomain: 'rossi.it' },
      { env: ENV, fetch, getToken: async () => 't', sanity: sanity.port, ...clock, pollTimeoutMs: 30_000, pollIntervalMs: 10_000 },
    )
    expect(out).toMatchObject({ state: 'waiting_for_site', code: 'tag_not_live', changed: ['sanity.googleSiteVerification'] })
    expect(calls.some((c) => c.url.includes('verificationMethod=META'))).toBe(false)
    expect(calls.some((c) => c.url.startsWith(WEBMASTERS_BASE))).toBe(false)
    expect(calls.filter((c) => c.url.includes('abluo-verify'))).toHaveLength(4) // t=0,10,20,30 s
    expect(sanity.store.get('site-1')?.googleSiteVerification).toBe('TOK123')
    expect(sanity.store.get('proj-1')?.integrationConfigs).toBeUndefined()
  })

  it('Google cannot find the tag (400 on verify) → waiting_for_site / verification_failed', async () => {
    const { fetch } = fakeFetch(searchConsoleGoogle({ tagAfterPolls: 1, verifyStatus: 400 }))
    const sanity = fakeSanity([projectDoc(), siteConfigDoc()])
    const out = await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: ENV, fetch, getToken: async () => 't', sanity: sanity.port, ...tick() })
    expect(out).toMatchObject({ state: 'waiting_for_site', code: 'verification_failed' })
  })

  it('idempotent re-run on a verified, connected site: no Sanity writes, no poll, no verify, no owner change', async () => {
    const { fetch, calls } = fakeFetch(searchConsoleGoogle({ verified: [SA, 'tom@tmz.it', 'ops@abluo.app'] }))
    const configs = withIntegration([], 'google-search-console', { siteUrl: SITE })
    const sanity = fakeSanity([projectDoc({ integrationConfigs: configs }), siteConfigDoc({ googleSiteVerification: 'TOK123' })])
    const out = await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: ENV, fetch, getToken: async () => 't', sanity: sanity.port, ...tick() })
    expect(out).toEqual({ state: 'connected', values: { siteUrl: SITE }, changed: [] })
    expect(sanity.mutations).toHaveLength(0)
    expect(calls.some((c) => c.url.includes('abluo-verify'))).toBe(false)
    expect(calls.filter((c) => c.method !== 'GET' && c.url.includes('webResource'))).toHaveLength(0)
    expect(calls.filter((c) => c.url.startsWith(WEBMASTERS_BASE))).toHaveLength(1) // sites.add is re-asserted (PUT is idempotent)
  })

  it('missing configuration and missing documents are clear errors', async () => {
    const sanity = fakeSanity([projectDoc(), siteConfigDoc()])
    expect(await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: {}, sanity: sanity.port })).toMatchObject({ state: 'error', code: 'not_configured' })
    const { fetch } = fakeFetch(searchConsoleGoogle())
    const empty = fakeSanity([])
    expect(await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: ENV, fetch, getToken: async () => 't', sanity: empty.port })).toMatchObject({
      state: 'error',
      code: 'sanity_missing',
    })
    expect(await connectSearchConsole({ slug: 'rossi', customDomain: null }, { env: ENV, fetch, getToken: async () => 't', sanity: sanity.port })).toMatchObject({
      state: 'waiting_for_site',
      code: 'no_domain',
    })
  })

  it('a switched-off API → api_disabled', async () => {
    const { fetch } = fakeFetch([
      domainRedirects,
      () => json({ error: { code: 403, message: 'Google Site Verification API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED' } }, 403),
    ])
    const out = await connectSearchConsole({ slug: 'rossi', customDomain: 'rossi.it' }, { env: ENV, fetch, getToken: async () => 't', sanity: fakeSanity([projectDoc(), siteConfigDoc()]).port })
    expect(out).toMatchObject({ state: 'error', code: 'api_disabled' })
  })
})

// ── Analytics ─────────────────────────────────────────────────────────────────

describe('setupAnalytics', () => {
  const PROJECT = { slug: 'rossi', name: 'Studio Rossi', customDomain: 'rossi.it' }

  it('creates the property and its web stream, then enables the integration', async () => {
    const { fetch, calls } = fakeFetch([
      domainRedirects,
      (url, init) => {
        if (url.pathname === '/v1beta/properties' && (init.method ?? 'GET') === 'GET') return json({ properties: [{ name: 'properties/999999', displayName: 'Other (other.it)' }] })
        if (url.pathname === '/v1beta/properties' && init.method === 'POST') return json({ name: 'properties/412345678', displayName: 'Studio Rossi (rossi.it)' })
        if (url.pathname === '/v1beta/properties/412345678/dataStreams' && (init.method ?? 'GET') === 'GET') return json({})
        if (url.pathname === '/v1beta/properties/412345678/dataStreams' && init.method === 'POST')
          return json({ name: 'properties/412345678/dataStreams/1', type: 'WEB_DATA_STREAM', webStreamData: { measurementId: 'G-NEW123', defaultUri: 'https://www.rossi.it' } })
        return undefined
      },
    ])
    const sanity = fakeSanity([projectDoc(), siteConfigDoc()])
    const out = await setupAnalytics(PROJECT, { env: ENV, fetch, getToken: async () => 't', sanity: sanity.port })

    expect(out).toEqual({ state: 'connected', values: { measurementId: 'G-NEW123', ga4PropertyId: '412345678' }, changed: ['google.propertyCreated', 'google.streamCreated', 'sanity.integration'] })
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts[0]).toMatchObject({
      url: `${ANALYTICS_ADMIN_BASE}/properties`,
      body: { parent: 'accounts/123456', displayName: 'Studio Rossi (rossi.it)', timeZone: 'Europe/Rome', currencyCode: 'EUR' },
    })
    expect(posts[1].body).toEqual({ type: 'WEB_DATA_STREAM', displayName: 'www.rossi.it', webStreamData: { defaultUri: 'https://www.rossi.it' } })
    expect(new URL(calls.find((c) => c.url.includes('filter='))!.url).searchParams.get('filter')).toBe('parent:accounts/123456')
    const ga = (sanity.store.get('proj-1')?.integrationConfigs as IntegrationEntry[])[0]
    expect(ga).toMatchObject({ _type: 'googleAnalyticsIntegrationConfig', integrationId: 'google-analytics', enabled: true, values: { _type: 'googleAnalyticsIntegrationValues', measurementId: 'G-NEW123', ga4PropertyId: '412345678' } })
  })

  it('re-run after an interrupted run reuses the property found by display name (no second property)', async () => {
    const { fetch, calls } = fakeFetch([
      domainRedirects,
      (url, init) => {
        if (url.pathname === '/v1beta/properties' && (init.method ?? 'GET') === 'GET') return json({ properties: [{ name: 'properties/412345678', displayName: 'Studio Rossi (rossi.it)' }] })
        if (url.pathname === '/v1beta/properties/412345678/dataStreams')
          return json({ dataStreams: [{ type: 'WEB_DATA_STREAM', webStreamData: { measurementId: 'G-NEW123', defaultUri: 'https://www.rossi.it' } }] })
        return undefined
      },
    ])
    const out = await setupAnalytics(PROJECT, { env: ENV, fetch, getToken: async () => 't', sanity: fakeSanity([projectDoc(), siteConfigDoc()]).port })
    expect(out).toMatchObject({ state: 'connected', values: { measurementId: 'G-NEW123', ga4PropertyId: '412345678' }, changed: ['sanity.integration'] })
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('measurement ID without a property ID → finds the property by its stream', async () => {
    const { fetch, calls } = fakeFetch([
      (url) => {
        if (url.pathname === '/v1beta/properties') return json({ properties: [{ name: 'properties/111111' }], nextPageToken: url.searchParams.get('pageToken') ? '' : 'p2' })
        if (url.pathname === '/v1beta/properties/111111/dataStreams') return json({ dataStreams: [{ type: 'WEB_DATA_STREAM', webStreamData: { measurementId: 'G-OTHER' } }] })
        if (url.pathname === '/v1beta/properties/222222/dataStreams') return json({ dataStreams: [{ type: 'WEB_DATA_STREAM', webStreamData: { measurementId: 'G-ABC' } }] })
        return undefined
      },
    ])
    // Page 2 of the property list holds the match.
    const fetch2 = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1beta/properties' && url.searchParams.get('pageToken') === 'p2') return json({ properties: [{ name: 'properties/222222' }] })
      return fetch(input, init)
    }) as unknown as typeof globalThis.fetch
    const configs = [{ _key: 'ga', _type: 'googleAnalyticsIntegrationConfig', integrationId: 'google-analytics', enabled: true, values: { _type: 'googleAnalyticsIntegrationValues', measurementId: 'G-ABC' } }]
    const sanity = fakeSanity([projectDoc({ integrationConfigs: configs }), siteConfigDoc()])
    const out = await setupAnalytics({ ...PROJECT, customDomain: null }, { env: ENV, fetch: fetch2, getToken: async () => 't', sanity: sanity.port })
    expect(out).toEqual({ state: 'connected', values: { measurementId: 'G-ABC', ga4PropertyId: '222222' }, changed: ['google.propertyFound', 'sanity.integration'] })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect((sanity.store.get('proj-1')?.integrationConfigs as IntegrationEntry[])[0]).toMatchObject({ _key: 'ga', values: { measurementId: 'G-ABC', ga4PropertyId: '222222' } })
  })

  it('already connected → no Google call, no write', async () => {
    const configs = withIntegration([], 'google-analytics', { measurementId: 'G-AB12', ga4PropertyId: '123456789' })
    const sanity = fakeSanity([projectDoc({ integrationConfigs: configs }), siteConfigDoc()])
    const getToken = vi.fn(async () => 't')
    const out = await setupAnalytics(PROJECT, { env: ENV, getToken, sanity: sanity.port })
    expect(out).toEqual({ state: 'connected', values: { measurementId: 'G-AB12', ga4PropertyId: '123456789' }, changed: [] })
    expect(getToken).not.toHaveBeenCalled()
    expect(sanity.mutations).toHaveLength(0)
  })

  it('403 from the Admin API → "give the service account Editor access to the account"', async () => {
    const { fetch } = fakeFetch([
      domainRedirects,
      () => json({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, 403),
    ])
    const out = await setupAnalytics(PROJECT, { env: ENV, fetch, getToken: async () => 't', sanity: fakeSanity([projectDoc(), siteConfigDoc()]).port })
    expect(out).toMatchObject({ state: 'error', code: 'analytics_permission', params: { email: SA, account: '123456' } })
    expect(out.state !== 'connected' && out.message).toBe(`Google Analytics refused the service account. Give ${SA} Editor access to Analytics account 123456.`)
  })

  it('no account id when one is needed → account_not_configured', async () => {
    const { fetch } = fakeFetch([domainRedirects])
    const out = await setupAnalytics(PROJECT, {
      env: { ...ENV, GOOGLE_ANALYTICS_ACCOUNT_ID: '' },
      fetch,
      getToken: async () => 't',
      sanity: fakeSanity([projectDoc(), siteConfigDoc()]).port,
    })
    expect(out).toMatchObject({ state: 'error', code: 'account_not_configured' })
  })
})

describe('errors', () => {
  it('GoogleSetupError carries code and params', () => {
    const e = new GoogleSetupError('analytics_permission', 'x', { email: 'a' })
    expect([e.code, e.params.email, e.message]).toEqual(['analytics_permission', 'a', 'x'])
  })
})
