import type { IntegrationManifest } from '../types'

// ── Google Search Console ─────────────────────────────────────────────────────
// ADR-029 §3.4. Reporting only: NO script, NO renderContract, NO cookies.
// The daily analytics snapshot job (src/lib/analytics) reads `siteUrl` with
// the Abluo service account; TrackingScripts / resolveTracking() only know the
// four tag integrations by id and ignore this one, so it never renders and
// never adds a purpose to the cookie banner (consentCategory 'necessary' is
// never consent-gated either).
//
// Site verification stays where it is (siteConfig SEO → googleSiteVerification);
// this manifest only says which Search Console property to read.

const googleSearchConsole: IntegrationManifest = {
  id: 'google-search-console',
  label: 'Google Search Console',
  version: '1.0.0',
  status: 'released',
  category: 'analytics',
  docsUrl: 'https://support.google.com/webmasters/answer/7687615',
  consentCategory: 'necessary',
  storage: 'content',
  fields: [
    {
      id: 'siteUrl',
      label: 'Search Console property',
      type: 'string',
      required: true,
      validation: {
        regex: '^(sc-domain:[a-z0-9.-]+\\.[a-z]{2,}|https?://[^\\s/]+(/[^\\s]*)?/)$',
        message:
          'Use sc-domain:example.com for a Domain property, or the exact URL-prefix property ending in / (https://www.example.com/)',
      },
      secret: false,
      description:
        'Exactly as the property is named in Search Console. The client must add the Abluo service account as a user on this property (docs/engineering/analytics-setup.md).',
    },
  ],
}

export default googleSearchConsole
