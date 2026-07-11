import type { CustomScript } from '@/lib/sanity/types'

// ─── Custom Script Filtering (pure, testable) ──────────────────────────────────
//
// Extracted from `TrackingScripts.tsx` (Sprint 1, Round 2 hardening) so the
// selection logic — which custom scripts render, where, and under what consent
// state — can be unit tested without a React render tree.
//
// Ownership: `CustomScript` / `ConsentCategory` are Sanity-contract types
// (`src/lib/sanity/types.ts`, owned by sanity-content-contracts — read only
// here). This module only consumes the shape.

/**
 * Visitor consent state for consent-gated script categories.
 *
 * `analytics`, `marketing`, and `functional` are consent-gated —
 * `necessary` scripts are never blocked by consent (they are
 * Abluo-admin-approved by construction: admin-created, `enabled === true`,
 * with a required description and category).
 */
export interface ConsentState {
  analytics: boolean
  marketing: boolean
  functional: boolean
}

/**
 * Filters a tenant's `customScripts` down to the ones that should render for
 * a given placement (and, optionally, a given consent state).
 *
 * Rules, applied in order:
 * 1. The script must have non-empty `code` — nothing to inject otherwise.
 * 2. `enabled` must be **strictly `true`**. The schema default is now
 *    `false` (hardening change, Round 2) — `undefined` and `false` both
 *    exclude the script. This is a deliberate fail-closed default: a script
 *    only ever runs if an editor has explicitly turned it on.
 * 3. The script's `placement` (`'head'` if unset) must match the requested
 *    `placement` argument.
 * 4. Consent gate — only applies to `consentCategory === 'analytics' | 'marketing' | 'functional'`:
 *    - If `consent` is **provided** (a `ConsentState`), the corresponding flag
 *      (`consent.analytics` / `consent.marketing` / `consent.functional`) must
 *      be `true`, or the script is excluded. This is the "never before
 *      consent" enforcement. `functional` is gated identically to
 *      `analytics`/`marketing` — no consent rules currently exist that permit
 *      functional scripts to load pre-consent, so a supplied `ConsentState`
 *      with `functional: false` blocks them exactly like the other two
 *      categories.
 *    - If `consent` is **`undefined`** (no consent mechanism has shipped yet),
 *      analytics/marketing/functional scripts are NOT gated and DO render.
 *      This is an interim, Tom-visible behavior: the platform does not yet
 *      collect consent, so gating on an unset signal would silently disable
 *      every such script tenants have already configured. The parameter
 *      exists precisely so that wiring up a future consent feature is a
 *      one-line change at the call site (pass a `ConsentState`) rather than a
 *      change to this filtering logic.
 *
 * `consentCategory` is optional on the type even though the Sanity schema now
 * requires it with no default — every document created going forward will
 * have it set. Documents where it is somehow `undefined` are treated as
 * equivalent to `'necessary'` (not consent-gated), since the schema
 * guarantees a value in practice and failing open on a missing category
 * (rather than blocking an otherwise-approved script) is the safer default
 * for this non-analytics/marketing case.
 */
export function filterCustomScripts(
  scripts: CustomScript[] | undefined,
  placement: 'head' | 'bodyEnd',
  consent?: ConsentState
): CustomScript[] {
  if (!scripts) return []

  return scripts.filter((script) => {
    if (!script.code) return false
    if (script.enabled !== true) return false

    const slot = script.placement ?? 'head'
    if (slot !== placement) return false

    if (consent !== undefined) {
      if (script.consentCategory === 'analytics' && !consent.analytics) return false
      if (script.consentCategory === 'marketing' && !consent.marketing) return false
      if (script.consentCategory === 'functional' && !consent.functional) return false
    }

    return true
  })
}

/**
 * Derives the `ConsentState` to pass to `filterCustomScripts` from a tenant's
 * `siteConfig.integrations.consentModeEnabled` flag (Sprint 1, Round 3;
 * extended to `functional` in Round 4 per Tom's decided safety rule).
 *
 * This is a synthetic, pre-consent-mechanism state — not real visitor
 * consent. The future consent feature will replace these hardcoded values
 * with an actual signal captured from the visitor (banner/cookie); until
 * that ships, "no consent mechanism exists" is treated as "no valid consent
 * was ever given," which is why every gated category defaults to blocked:
 * - `consentModeEnabled === true` → returns
 *   `{ analytics: false, marketing: false, functional: false }`, i.e.
 *   fail-closed across all three gated categories. A consent-aware tenant's
 *   `analytics`/`marketing`/`functional`-category custom scripts do not
 *   render until a real `ConsentState` sourced from an actual visitor
 *   consent signal replaces this hardcoded closed state. `functional` is
 *   included because no consent rules currently exist that explicitly permit
 *   functional scripts to load pre-consent — absent such rules, they fail
 *   closed like analytics/marketing. Only `necessary` scripts are exempt
 *   (see `filterCustomScripts` and `builtInTrackingAllowed`).
 * - `consentModeEnabled` is `false` or `undefined` → returns `undefined`,
 *   preserving the prior interim behavior: no `ConsentState` means
 *   `filterCustomScripts` does not gate on `consentCategory` at all.
 *
 * Scope note: this governs the CUSTOM scripts path (via `consentCategory`).
 * The built-in GA4/GTM/Meta Pixel snippets in `TrackingScripts.tsx` are
 * governed separately by `builtInTrackingAllowed()` — as of Round 4, they are
 * ALSO suppressed whenever `consentModeEnabled === true`, in addition to
 * `integrations.analyticsEnabled === true` (Tom's master-gate rule). This
 * closes the previously deferred question: "ships later" is not permission
 * to load tracking without consent.
 */
export function consentStateFor(consentModeEnabled: boolean | undefined): ConsentState | undefined {
  return consentModeEnabled === true
    ? { analytics: false, marketing: false, functional: false }
    : undefined
}

/**
 * Whether built-in tracking snippets (GA4, GTM — including its bodyEnd
 * noscript iframe — and Meta Pixel) are allowed to render at all.
 *
 * Tom's decided rule (Sprint 1, Round 4 — settles the question deferred in
 * Round 3): until a real visitor-consent mechanism ships, enabling consent
 * mode with no valid consent state means GA4 must NOT load, GTM must NOT
 * load, and Meta Pixel must NOT load. There is no partial-consent capture
 * today, so `consentModeEnabled === true` is treated as "no valid consent
 * exists" and every built-in is blocked. The absence of a consent mechanism
 * is never itself permission to load tracking — "the consent feature ships
 * later" does not authorize loading built-in tracking scripts before it
 * does.
 *
 * - `consentModeEnabled === true` → `false` (built-ins blocked).
 * - `consentModeEnabled === false` or `undefined` → `true` (built-ins
 *   allowed, subject to the separate `analyticsEnabled` master gate already
 *   enforced in `TrackingScripts.tsx`).
 */
export function builtInTrackingAllowed(consentModeEnabled: boolean | undefined): boolean {
  return consentModeEnabled !== true
}
