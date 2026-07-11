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
  ],
}

export default googleAnalytics
