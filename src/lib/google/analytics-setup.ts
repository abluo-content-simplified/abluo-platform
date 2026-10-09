// Server-only: calls Google with the Abluo service account and writes Sanity.
import { GoogleSetupError, setupErrorFrom, stoppedOutcome, type SetupOutcome } from './errors'
import { googleRequest, serviceAccountEmail, setupToken, type GoogleDeps } from './http'
import { findIntegration, loadGoogleSanityState, SanityStateError, writeIntegration, type SanityPort } from './sanity-config'
import { resolveCanonicalSiteUrl, siteHost } from './site-url'

/**
 * "Set up Analytics" for one project (docs/engineering/analytics-setup.md →
 * Automatic setup). Reads the google-analytics integration first:
 *
 *   a. measurementId + ga4PropertyId    → nothing to create (entry enabled)
 *   b. neither                          → find (by display name) or create a GA4
 *                                         property under GOOGLE_ANALYTICS_ACCOUNT_ID,
 *                                         then find or create its web stream
 *   c. measurementId, no property id    → find the property whose stream has it
 *   (property id, no measurementId      → its web stream, created if missing)
 *   d. write the entry: enabled, values { measurementId, ga4PropertyId }
 *
 * Enabling the entry turns on the GA tag, and so the cookie banner's
 * analytics category (ADR-021) — expected.
 *
 * Idempotent: a re-run finds what the previous one created (display name is
 * deterministic), so a run interrupted between property and stream does not
 * create a second property. A 403 from the Admin API becomes the actionable
 * "give <SA> Editor access to Analytics account <id>".
 */

export const ANALYTICS_ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta'
/** Platform defaults for a new property (Abluo's clients are in Italy). */
export const DEFAULT_TIME_ZONE = 'Europe/Rome'
export const DEFAULT_CURRENCY = 'EUR'

const GA4_PROPERTY_RE = /^[0-9]{6,12}$/
const MEASUREMENT_RE = /^G-[A-Z0-9]+$/

type Env = Record<string, string | undefined>
export type AnalyticsDeps = GoogleDeps & { sanity: SanityPort }
export type AnalyticsValues = { measurementId: string; ga4PropertyId: string }

type Property = { name?: string; displayName?: string; parent?: string }
type DataStream = { name?: string; type?: string; displayName?: string; webStreamData?: { measurementId?: string; defaultUri?: string } }

/** Pure: GOOGLE_ANALYTICS_ACCOUNT_ID as digits ("accounts/123" and "123" both accepted), or null. */
export function analyticsAccountId(env: Env = process.env): string | null {
  const raw = (env.GOOGLE_ANALYTICS_ACCOUNT_ID ?? '').trim().replace(/^accounts\//, '')
  return /^[0-9]+$/.test(raw) ? raw : null
}

/** Pure: the GA4 property display name — deterministic, so a re-run finds it. */
export function propertyDisplayName(projectName: string, siteUrl: string): string {
  return `${projectName.trim()} (${siteHost(siteUrl).replace(/^www\./, '')})`
}

/** Pure: "properties/123" → "123". */
export function propertyIdOf(name: string | undefined): string | null {
  const id = name?.split('/')[1] ?? ''
  return GA4_PROPERTY_RE.test(id) ? id : null
}

/** Pure: the web stream to use — the one for this host first, else the first web stream. */
export function pickWebStream(streams: readonly DataStream[], siteUrl: string): DataStream | null {
  const web = streams.filter((s) => s.type === 'WEB_DATA_STREAM' && s.webStreamData?.measurementId)
  const host = siteHost(siteUrl).replace(/^www\./, '')
  const sameHost = web.find((s) => {
    try {
      return new URL(s.webStreamData?.defaultUri ?? '').host.replace(/^www\./, '') === host
    } catch {
      return false
    }
  })
  return sameHost ?? web[0] ?? null
}

export async function setupAnalytics(
  project: { slug: string; name: string; customDomain: string | null },
  deps: AnalyticsDeps,
): Promise<SetupOutcome<AnalyticsValues>> {
  const changed: string[] = []
  try {
    const saEmail = serviceAccountEmail(deps.env)
    let state
    try {
      state = await loadGoogleSanityState(deps.sanity, project.slug)
    } catch (e) {
      if (e instanceof SanityStateError) throw new GoogleSetupError('sanity_missing', e.message)
      throw e
    }
    const existing = findIntegration(state.project.published.integrationConfigs, 'google-analytics')?.values ?? {}
    let measurementId = typeof existing.measurementId === 'string' && MEASUREMENT_RE.test(existing.measurementId.trim()) ? existing.measurementId.trim() : null
    let propertyId = typeof existing.ga4PropertyId === 'string' && GA4_PROPERTY_RE.test(existing.ga4PropertyId.trim()) ? existing.ga4PropertyId.trim() : null

    if (!measurementId || !propertyId) {
      const accountId = analyticsAccountId(deps.env)
      const forbidden = () =>
        new GoogleSetupError(
          'analytics_permission',
          `Google Analytics refused the service account. Give ${saEmail} Editor access to Analytics account ${accountId ?? '(GOOGLE_ANALYTICS_ACCOUNT_ID)'}.`,
          { email: saEmail, account: accountId ?? '—' },
        )
      try {
        const token = await setupToken(deps)
        const call = <T>(url: string, init?: Parameters<typeof googleRequest>[4]) => googleRequest<T>(deps, token, 'Analytics Admin', url, init)

        const listStreams = async (pid: string): Promise<DataStream[]> => {
          const out: DataStream[] = []
          let page: string | undefined
          do {
            const q = new URLSearchParams({ pageSize: '200', ...(page ? { pageToken: page } : {}) })
            const res = await call<{ dataStreams?: DataStream[]; nextPageToken?: string }>(`${ANALYTICS_ADMIN_BASE}/properties/${pid}/dataStreams?${q}`)
            out.push(...(res.dataStreams ?? []))
            page = res.nextPageToken || undefined
          } while (page)
          return out
        }
        const listProperties = async (account: string): Promise<Property[]> => {
          const out: Property[] = []
          let page: string | undefined
          do {
            const q = new URLSearchParams({ filter: `parent:accounts/${account}`, pageSize: '200', ...(page ? { pageToken: page } : {}) })
            const res = await call<{ properties?: Property[]; nextPageToken?: string }>(`${ANALYTICS_ADMIN_BASE}/properties?${q}`)
            out.push(...(res.properties ?? []))
            page = res.nextPageToken || undefined
          } while (page)
          return out
        }
        const needAccount = (): string => {
          if (!accountId) throw new GoogleSetupError('account_not_configured', 'GOOGLE_ANALYTICS_ACCOUNT_ID is not set on this deployment.')
          return accountId
        }

        if (measurementId && !propertyId) {
          // c. Find the property whose web stream carries this measurement ID.
          for (const p of await listProperties(needAccount())) {
            const pid = propertyIdOf(p.name)
            if (pid && (await listStreams(pid)).some((s) => s.webStreamData?.measurementId === measurementId)) {
              propertyId = pid
              break
            }
          }
          if (!propertyId) {
            throw new GoogleSetupError(
              'google_error',
              `No GA4 property in Analytics account ${accountId} has a web stream with ${measurementId}. Add its property ID in Studio, or give ${saEmail} access to the account that owns it.`,
            )
          }
          changed.push('google.propertyFound')
        } else {
          const siteUrl = await resolveCanonicalSiteUrl(project.customDomain, deps)
          if (!propertyId) {
            // b. Find (re-run) or create the property.
            const account = needAccount()
            const displayName = propertyDisplayName(project.name, siteUrl)
            const found = (await listProperties(account)).find((p) => p.displayName === displayName)
            propertyId = propertyIdOf(found?.name)
            if (!propertyId) {
              const created = await call<Property>(`${ANALYTICS_ADMIN_BASE}/properties`, {
                method: 'POST',
                body: { parent: `accounts/${account}`, displayName, timeZone: DEFAULT_TIME_ZONE, currencyCode: DEFAULT_CURRENCY },
              })
              propertyId = propertyIdOf(created.name)
              if (!propertyId) throw new GoogleSetupError('google_error', `Analytics Admin created a property without a usable id (${created.name ?? 'none'}).`)
              changed.push('google.propertyCreated')
            }
          }
          // The web stream: reuse, else create.
          const stream = pickWebStream(await listStreams(propertyId), siteUrl)
          measurementId = stream?.webStreamData?.measurementId ?? null
          if (!measurementId) {
            const created = await call<DataStream>(`${ANALYTICS_ADMIN_BASE}/properties/${propertyId}/dataStreams`, {
              method: 'POST',
              body: { type: 'WEB_DATA_STREAM', displayName: siteHost(siteUrl), webStreamData: { defaultUri: siteUrl.replace(/\/$/, '') } },
            })
            measurementId = created.webStreamData?.measurementId ?? null
            if (!measurementId) throw new GoogleSetupError('google_error', 'Analytics Admin created a web stream without a measurement ID.')
            changed.push('google.streamCreated')
          }
        }
      } catch (e) {
        throw setupErrorFrom(e, forbidden)
      }
    }

    if (await writeIntegration(deps.sanity, state, 'google-analytics', { measurementId, ga4PropertyId: propertyId })) changed.push('sanity.integration')
    return { state: 'connected', values: { measurementId, ga4PropertyId: propertyId }, changed }
  } catch (e) {
    return stoppedOutcome(setupErrorFrom(e), changed)
  }
}
