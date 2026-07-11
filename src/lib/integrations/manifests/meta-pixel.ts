import type { IntegrationManifest } from '../types'

// ── Meta Pixel ─────────────────────────────────────────────────────────────────
// ADR-014 Phase A. Relocates the value previously hand-projected as
// siteConfig.integrations.metaPixelId (src/lib/sanity/schema.ts ~L3138–3144)
// into a generated integration. Field regex/message carried over unchanged.
//
// consentCategory is 'marketing' (not 'analytics') — Meta Pixel is a marketing/
// ad-attribution tracker, matching the existing customScript consentCategory
// convention used for comparable third-party pixels.

const metaPixel: IntegrationManifest = {
  id: 'meta-pixel',
  label: 'Meta Pixel',
  version: '1.0.0',
  status: 'released',
  category: 'analytics',
  docsUrl: 'https://www.facebook.com/business/help/952192354843755',
  consentCategory: 'marketing',
  storage: 'content',
  renderContract: { component: 'TrackingScripts' },
  fields: [
    {
      id: 'pixelId',
      label: 'Pixel ID',
      type: 'string',
      required: true,
      validation: {
        regex: '^[0-9]+$',
        message: 'Must contain digits only',
      },
      secret: false,
      description: 'Numeric Meta (Facebook) Pixel ID.',
    },
  ],
}

export default metaPixel
