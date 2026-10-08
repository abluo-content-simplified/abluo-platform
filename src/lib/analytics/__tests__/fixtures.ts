/** Fixture JSON shaped like real GA4 Data API / Search Console API responses. */
import type { Ga4BatchResponse } from '../ga4'
import type { GscResponse } from '../gsc'

export const NOW = new Date('2026-10-08T04:30:00Z')

export const GA4_BATCH: Ga4BatchResponse = {
  reports: [
    {
      dimensionHeaders: [{ name: 'dateRange' }],
      metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      rows: [
        { dimensionValues: [{ value: 'current' }], metricValues: [{ value: '1200' }, { value: '1500' }, { value: '4100' }] },
        { dimensionValues: [{ value: 'previous' }], metricValues: [{ value: '1000' }, { value: '1300' }, { value: '3900' }] },
        { dimensionValues: [{ value: 'last7' }], metricValues: [{ value: '330' }, { value: '400' }, { value: '1000' }] },
        // previous7 omitted on purpose: GA4 drops all-zero rows
      ],
    },
    {
      dimensionHeaders: [{ name: 'pagePath' }],
      metricHeaders: [{ name: 'screenPageViews' }],
      rows: [
        { dimensionValues: [{ value: '/' }], metricValues: [{ value: '2000' }] },
        { dimensionValues: [{ value: '/it/servizi' }], metricValues: [{ value: '800' }] },
      ],
    },
    {
      dimensionHeaders: [{ name: 'sessionDefaultChannelGroup' }],
      metricHeaders: [{ name: 'sessions' }],
      rows: [
        { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '900' }] },
        { dimensionValues: [{ value: 'Direct' }], metricValues: [{ value: '400' }] },
      ],
    },
    {
      dimensionHeaders: [{ name: 'date' }],
      metricHeaders: [{ name: 'activeUsers' }],
      rows: [
        { dimensionValues: [{ value: '20260910' }], metricValues: [{ value: '40' }] },
        { dimensionValues: [{ value: '20261007' }], metricValues: [{ value: '55' }] },
      ],
    },
  ],
}

export const GSC_DAILY: GscResponse = {
  rows: [
    // previous window (2026-08-13 … 2026-09-09)
    { keys: ['2026-08-20'], clicks: 10, impressions: 200, ctr: 0.05, position: 12 },
    // current window (2026-09-10 … 2026-10-07)
    { keys: ['2026-09-10'], clicks: 20, impressions: 400, ctr: 0.05, position: 10 },
    { keys: ['2026-10-07'], clicks: 30, impressions: 600, ctr: 0.05, position: 5 },
  ],
}

export const GSC_QUERIES: GscResponse = {
  rows: [
    { keys: ['dentista cervia'], clicks: 25, impressions: 300, ctr: 0.083, position: 3.2 },
    { keys: ['igiene dentale'], clicks: 9, impressions: 150, ctr: 0.06, position: 6.1 },
  ],
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
