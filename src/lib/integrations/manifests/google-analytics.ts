import type { IntegrationManifest } from '../types'

// ── Google Analytics (GA4) ────────────────────────────────────────────────────
// ADR-014 Phase A. Relocates the values previously hand-projected as
// siteConfig.integrations.googleAnalyticsId (src/lib/sanity/schema.ts ~L3112–3118)
// into a generated integration. Field regex/message carried over unchanged.

const googleAnalytics: IntegrationManifest = {
  id: 'google-analytics',
  label: 'Google Analytics (GA4)',
  version: '1.0.0',
  status: 'released',
  category: 'analytics',
  docsUrl: 'https://support.google.com/analytics/answer/9539598',
  consentCategory: 'analytics',
  storage: 'content',
  renderContract: { component: 'TrackingScripts' },
  fields: [
    {
      id: 'measurementId',
      label: 'Measurement ID',
      type: 'string',
      required: true,
      validation: {
        regex: '^G-[A-Z0-9]+$',
        message: 'Must be in the format G-XXXXXXXXXX',
      },
      secret: false,
      description: 'GA4 Measurement ID, format G-XXXXXXXXXX.',
    },
    {
      // ADR-029 §3.4 — read server-side by the daily analytics snapshot job
      // (src/lib/analytics) with the Abluo service account. Never rendered,
      // never shown to the tenant. Optional: without it, the client dashboard
      // shows "not connected yet" and the tracking tag is unaffected.
      id: 'ga4PropertyId',
      label: 'GA4 property ID (reporting)',
      type: 'string',
      required: false,
      validation: {
        regex: '^[0-9]{6,12}$',
        message: 'Must be the numeric GA4 property ID (Admin → Property details), e.g. 412345678',
      },
      secret: false,
      description:
        'Numeric property ID used to read visitor numbers for the client dashboard. The client must add the Abluo service account as a Viewer on this property (docs/engineering/analytics-setup.md).',
    },
  ],
}

export default googleAnalytics
