import { createVerify, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsIdsFrom } from '../config'
import { fetchGa4Metrics, ga4BatchRequest, mapGa4Batch } from '../ga4'
import {
  AnalyticsConfigError,
  getGoogleAccessToken,
  GOOGLE_TOKEN_URL,
  readServiceAccount,
  resetGoogleTokenCache,
  signServiceAccountJwt,
} from '../google-auth'
import { fetchGscMetrics, gscTotals, mapGsc } from '../gsc'
import { daysOf, snapshotWindows } from '../periods'
import { GA4_BATCH, GSC_DAILY, GSC_QUERIES, jsonResponse, NOW } from './fixtures'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const ENV = { GOOGLE_ANALYTICS_SA_EMAIL: 'abluo@proj.iam.gserviceaccount.com', GOOGLE_ANALYTICS_SA_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') }
const W = snapshotWindows(NOW)

describe('periods', () => {
  it('four windows ending yesterday (UTC)', () => {
    expect(W.current).toEqual({ start: '2026-09-10', end: '2026-10-07' })
    expect(W.previous).toEqual({ start: '2026-08-13', end: '2026-09-09' })
    expect(W.last7).toEqual({ start: '2026-10-01', end: '2026-10-07' })
    expect(W.previous7).toEqual({ start: '2026-09-24', end: '2026-09-30' })
    expect(daysOf(W.current)).toHaveLength(28)
  })
})

describe('google-auth', () => {
  beforeEach(() => resetGoogleTokenCache())

  it('reads the service account, accepting literal \\n in the key', () => {
    expect(readServiceAccount({})).toBeNull()
    expect(readServiceAccount(ENV)?.privateKey).toBe(privateKey.trim())
  })

  it('signs a verifiable RS256 JWT with the right claims', () => {
    const jwt = signServiceAccountJwt(readServiceAccount(ENV)!, ['s1', 's2'], 1_000_000)
    const [h, c, sig] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: ENV.GOOGLE_ANALYTICS_SA_EMAIL,
      scope: 's1 s2',
      aud: GOOGLE_TOKEN_URL,
      iat: 1_000_000,
      exp: 1_003_600,
    })
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
  })

  it('exchanges the JWT once and caches the token until shortly before expiry', async () => {
    const fetch = vi.fn(async () => jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
    let now = 0
    const deps = { env: ENV, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now }
    expect(await getGoogleAccessToken(deps)).toBe('tok-1')
    now = 3_000_000
    expect(await getGoogleAccessToken(deps)).toBe('tok-1')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(GOOGLE_TOKEN_URL)
    expect(String(init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    now = 3_550_000 // within the last minute → refresh
    await getGoogleAccessToken(deps)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('missing configuration → AnalyticsConfigError; refused exchange → readable error', async () => {
    await expect(getGoogleAccessToken({ env: {} })).rejects.toBeInstanceOf(AnalyticsConfigError)
    const fetch = vi.fn(async () => jsonResponse({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400))
    await expect(getGoogleAccessToken({ env: ENV, fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow(/400.*Invalid JWT Signature/)
  })
})

describe('GA4', () => {
  it('asks for the four windows in one totals report', () => {
    const body = ga4BatchRequest(W)
    expect(body.requests).toHaveLength(4)
    expect((body.requests[0].dateRanges as { name?: string }[]).map((r) => r.name)).toEqual(['current', 'previous', 'last7', 'previous7'])
  })

  it('maps a batch response; omitted rows count as zero; every day present', () => {
    const m = mapGa4Batch(GA4_BATCH, W)
    expect(m.current).toEqual({ users: 1200, sessions: 1500, page_views: 4100 })
    expect(m.previous.users).toBe(1000)
    expect(m.previous7).toEqual({ users: 0, sessions: 0, page_views: 0 })
    expect(m.top_pages[0]).toEqual({ path: '/', views: 2000 })
    expect(m.top_channels.map((c) => c.channel)).toEqual(['Organic Search', 'Direct'])
    expect(m.daily).toHaveLength(28)
    expect(m.daily[0]).toEqual({ date: '2026-09-10', users: 40 })
    expect(m.daily[27]).toEqual({ date: '2026-10-07', users: 55 })
    expect(m.daily[1].users).toBe(0)
  })

  it('handles unnamed date ranges and an empty response', () => {
    const unnamed = { reports: [{ ...GA4_BATCH.reports![0], rows: [{ dimensionValues: [{ value: 'date_range_1' }], metricValues: [{ value: '7' }, { value: '8' }, { value: '9' }] }] }] }
    expect(mapGa4Batch(unnamed, W).previous).toEqual({ users: 7, sessions: 8, page_views: 9 })
    expect(mapGa4Batch({}, W).current.users).toBe(0)
  })

  it('calls batchRunReports with the bearer token; a 403 becomes a readable error', async () => {
    const ok = vi.fn(async () => jsonResponse(GA4_BATCH))
    await fetchGa4Metrics('412345678', W, 'tok', ok as unknown as typeof fetch)
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/412345678:batchRunReports')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    const denied = vi.fn(async () => jsonResponse({ error: { code: 403, message: 'User does not have sufficient permissions for this property.', status: 'PERMISSION_DENIED' } }, 403))
    await expect(fetchGa4Metrics('412345678', W, 'tok', denied as unknown as typeof fetch)).rejects.toThrow(
      'GA4 403 PERMISSION_DENIED: User does not have sufficient permissions for this property.',
    )
    await expect(fetchGa4Metrics('../x', W, 'tok', ok as unknown as typeof fetch)).rejects.toThrow(/not numeric/)
  })
})

describe('Search Console', () => {
  it('sums windows from daily rows with an impression-weighted position', () => {
    const t = gscTotals(GSC_DAILY.rows!, W.current)
    expect(t.clicks).toBe(50)
    expect(t.impressions).toBe(1000)
    expect(t.ctr).toBeCloseTo(0.05)
    expect(t.position).toBe(7) // (10·400 + 5·600) / 1000
    expect(gscTotals([], W.current)).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 })
  })

  it('maps both responses', () => {
    const m = mapGsc(GSC_DAILY, GSC_QUERIES, W)
    expect(m.previous.clicks).toBe(10)
    expect(m.last7.clicks).toBe(30)
    expect(m.top_queries[0]).toEqual({ query: 'dentista cervia', clicks: 25, impressions: 300 })
    expect(m.daily).toHaveLength(28)
    expect(m.daily.at(-1)).toEqual({ date: '2026-10-07', clicks: 30, impressions: 600 })
  })

  it('encodes the property in the URL and asks for fresh data', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => jsonResponse(JSON.parse(String(init.body)).dimensions[0] === 'date' ? GSC_DAILY : GSC_QUERIES))
    const m = await fetchGscMetrics('sc-domain:example.com', W, 'tok', f as unknown as typeof fetch)
    expect(m.current.clicks).toBe(50)
    expect(f.mock.calls[0][0]).toBe('https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query')
    expect(JSON.parse(String(f.mock.calls[0][1].body)).dataState).toBe('all')
  })
})

describe('config', () => {
  it('reads the GA4 property regardless of the tag switch; GSC only when enabled', () => {
    expect(
      analyticsIdsFrom([
        { integrationId: 'google-analytics', enabled: false, values: { measurementId: 'G-X', ga4PropertyId: '412345678' } },
        { integrationId: 'google-search-console', enabled: true, values: { siteUrl: 'sc-domain:example.com' } },
      ]),
    ).toEqual({ ga4PropertyId: '412345678', gscSiteUrl: 'sc-domain:example.com' })
    expect(analyticsIdsFrom([{ integrationId: 'google-search-console', enabled: false, values: { siteUrl: 'sc-domain:example.com' } }]).gscSiteUrl).toBeNull()
  })

  it('ignores malformed values and missing configs', () => {
    expect(analyticsIdsFrom(null)).toEqual({ ga4PropertyId: null, gscSiteUrl: null })
    expect(
      analyticsIdsFrom([
        { integrationId: 'google-analytics', values: { ga4PropertyId: 'G-ABC' } },
        { integrationId: 'google-search-console', enabled: true, values: { siteUrl: 'example.com' } },
      ]),
    ).toEqual({ ga4PropertyId: null, gscSiteUrl: null })
  })
})
