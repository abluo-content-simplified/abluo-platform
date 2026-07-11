import type { IntegrationManifest } from '../types'

// ── Custom Scripts ─────────────────────────────────────────────────────────────
// ADR-014 Phase A, relocating ADR-013's Round-2/Round-4-hardened
// siteConfig.integrations.customScripts (src/lib/sanity/schema.ts ~L3146–3212)
// into a generated integration.
//
// Special case: every other integration's `values` object holds one field per
// scalar setting. Custom Scripts holds an ARRAY of scripts, each carrying its
// own independent consentCategory — the array shape ADR-013 hardened
// specifically so that one script can be 'necessary' while another is
// 'marketing'. That per-script granularity cannot be represented as a single
// manifest-level consentCategory, so:
//
//   - manifest-level `consentCategory: 'necessary'` below describes only the
//     integration SHELL — the Developers → Custom Scripts Studio page itself
//     is never consent-gated (an admin must always be able to open it to
//     manage scripts, regardless of visitor consent state).
//   - Per-script gating is untouched by this ADR: each entry in the array
//     still carries its own required consentCategory
//     (necessary | analytics | marketing | functional), exactly as ADR-013
//     hardened it. TrackingScripts' filtering logic (unchanged here — that is
//     Phase C's concern) reads the per-script value, never this manifest-level
//     one.
//
// The single field below uses `type: 'customScriptArray'` — a marker
// recognized explicitly by buildIntegrationSchemaTypes() in schema.ts, which
// reproduces the exact array-of-objects shape from the pre-ADR-014
// siteConfig.integrations.customScripts field. AI decides: this is the one
// manifest whose field mechanism is special, exactly as called out in the
// Phase A task brief — no other Phase A integration needs it.
//
// ADR-013 security hardening (carried forward unchanged): trusted third-party
// integrations only; never paste secrets or server-side API keys; prefer
// external src-based scripts over inline snippets; admin-only, never exposed to
// tenants or the client dashboard.

const customScripts: IntegrationManifest = {
  id: 'custom-scripts',
  label: 'Custom Scripts',
  version: '1.0.0',
  status: 'released',
  category: 'developers',
  consentCategory: 'necessary', // integration shell only — see design note above
  storage: 'content',
  fields: [
    {
      id: 'scripts',
      label: 'Scripts',
      type: 'customScriptArray',
      required: false,
      secret: false,
      description:
        'Platform feature managed exclusively by Abluo administrators — never exposed to tenants or the client dashboard. Intended only for trusted third-party integrations (Google, Meta, LinkedIn, Hotjar, etc.). Never paste secrets or server-side API keys. Prefer external src-based scripts over large inline snippets. Code is injected verbatim into the page.',
    },
  ],
}

export default customScripts
