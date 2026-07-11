import type { IntegrationManifest } from '../types'

// ── Google Tag Manager ────────────────────────────────────────────────────────
// ADR-014 Phase A. Relocates the value previously hand-projected as
// siteConfig.integrations.googleTagManagerId (src/lib/sanity/schema.ts
// ~L3119–3125) into a generated integration. Field regex/message carried over
// unchanged.

const googleTagManager: IntegrationManifest = {
  id: 'google-tag-manager',
  label: 'Google Tag Manager',
  version: '1.0.0',
  status: 'released',
  category: 'analytics',
  docsUrl: 'https://support.google.com/tagmanager/answer/6103696',
  consentCategory: 'analytics',
  storage: 'content',
  renderContract: { component: 'TrackingScripts' },
  fields: [
    {
      id: 'containerId',
      label: 'Container ID',
      type: 'string',
      required: true,
      validation: {
        regex: '^GTM-[A-Z0-9]+$',
        message: 'Must be in the format GTM-XXXXXXX',
      },
      secret: false,
      description: 'GTM Container ID, format GTM-XXXXXXX.',
    },
  ],
}

export default googleTagManager
