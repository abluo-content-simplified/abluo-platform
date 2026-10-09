import { analyticsIdsFrom } from '@/lib/analytics/config'
import { findIntegration, type IntegrationEntry } from './sanity-config'

/**
 * The Google card's resting state (admin project page), derived from what is
 * stored — no Google call:
 *
 *   Analytics       Connected   google-analytics enabled with a measurement ID
 *                               AND a GA4 property ID (tag + reporting)
 *                   Not set up  anything less
 *   Search Console  Connected   google-search-console enabled with a valid property
 *                   Waiting     the verification token is on the site settings
 *                               but the property is not connected yet
 *                   Not set up  neither
 *
 * "Error" exists only as the result of a run (shown until the next one).
 */
export type GoogleRowState = 'connected' | 'not_set_up' | 'waiting_for_site' | 'error'

export type GoogleCardState = {
  analytics: { state: GoogleRowState; measurementId: string | null; ga4PropertyId: string | null }
  searchConsole: { state: GoogleRowState; siteUrl: string | null }
}

const MEASUREMENT_RE = /^G-[A-Z0-9]+$/

export function googleCardState(configs: readonly IntegrationEntry[] | null | undefined, verificationToken: string | null | undefined): GoogleCardState {
  const ga = findIntegration(configs, 'google-analytics')
  const m = typeof ga?.values?.measurementId === 'string' && MEASUREMENT_RE.test(ga.values.measurementId) ? ga.values.measurementId : null
  const { ga4PropertyId, gscSiteUrl } = analyticsIdsFrom(configs as Parameters<typeof analyticsIdsFrom>[0])
  return {
    analytics: { state: ga?.enabled === true && m && ga4PropertyId ? 'connected' : 'not_set_up', measurementId: m, ga4PropertyId },
    searchConsole: { state: gscSiteUrl ? 'connected' : verificationToken?.trim() ? 'waiting_for_site' : 'not_set_up', siteUrl: gscSiteUrl },
  }
}

/** Pure: which env pieces are present (the card says what is missing; never the values). */
export function googleSetupEnv(env: Record<string, string | undefined> = process.env): {
  serviceAccount: boolean
  analyticsAccount: boolean
  owners: boolean
} {
  return {
    serviceAccount: Boolean(env.GOOGLE_ANALYTICS_SA_EMAIL?.trim() && env.GOOGLE_ANALYTICS_SA_PRIVATE_KEY?.trim()),
    analyticsAccount: /^(accounts\/)?[0-9]+$/.test((env.GOOGLE_ANALYTICS_ACCOUNT_ID ?? '').trim()),
    owners: Boolean(env.GOOGLE_SEARCH_CONSOLE_OWNERS?.trim()),
  }
}
