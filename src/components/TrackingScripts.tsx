import type { ProjectIntegrations } from '@/lib/sanity/types'
import { isProduction } from '@/lib/deployment'
import { resolveTracking } from '@/lib/tracking/resolve'
import {
  filterCustomScripts,
  consentStateFor,
  builtInTrackingAllowed,
} from '@/lib/tracking/custom-scripts'

// ─── Tracking / Analytics Scripts ──────────────────────────────────────────────
//
// Renders GA4, GTM, Meta Pixel, and tenant custom scripts sourced from the
// Integration Registry runtime (ADR-014 Phase A: `project.integrationConfigs`
// + Phase B: `project.privacy`), fetched via `projectIntegrationsQuery`
// (`src/lib/sanity/queries.ts`) and passed in as `data`. This component is a
// thin renderer — all "what should render" decisions are delegated to the
// pure `resolveTracking()` helper (`src/lib/tracking/resolve.ts`).
// Production-only: analytics from dev/preview deployments would pollute
// tenant data (AI recommends — reversible).
//
// ── Model change (ADR-014 Phase C — replaces the ADR-013 Sprint-1 model) ──────
// The old model (`siteConfig.integrations.analyticsEnabled` as a single master
// switch, removed from the schema in Phase B) is replaced by two independent
// gates read from `project.privacy`:
//   1. `privacy.trackingKillSwitch === true` — emergency override. Renders
//      NOTHING, in both `head` and `bodyEnd` placements, regardless of any
//      individual integration's `enabled` state. This is the direct successor
//      to the old `analyticsEnabled !== true` early return: one check, one
//      early return, covering the whole component.
//   2. Per-integration `enabled === true` (strict, fail-closed) — with the
//      kill switch off, each of GA4 / GTM / Meta Pixel / custom scripts is
//      independently gated by its own `IntegrationConfig.enabled` in
//      `project.integrationConfigs` (the Integration Registry, ADR-014 Phase
//      A). There is no single flag that enables "all tracking" anymore —
//      each integration is switched on individually in Studio's
//      IntegrationsPane.
// `resolveTracking()` performs both checks and returns only the values that
// passed; this component never reads `integrationConfigs`/`privacy` directly.
//
// `privacy.consentModeEnabled` feeds the EXISTING, unmodified helpers exactly
// as before (Sprint 1 Round 3/4 — Tom's verbatim fail-closed rule):
//   - `builtInTrackingAllowed(consentModeEnabled)` gates GA4, GTM (including
//     its bodyEnd noscript iframe), and Meta Pixel.
//   - `consentStateFor(consentModeEnabled)` derives the `ConsentState` passed
//     to `filterCustomScripts`, which fails closed on
//     analytics/marketing/functional-category custom scripts pre-consent;
//     `necessary` scripts are never gated (see `custom-scripts.ts` TSDoc for
//     Tom's rule verbatim — that module is unchanged by Phase C).
//
// Uses plain <script> tags, NOT next/script. Precedent: `layout.tsx` previously
// used `<Script strategy="beforeInteractive">` in this same Server Component
// tree and it was replaced with a plain <script> for React 19 compatibility
// (see project history "React 19 Script fix", V0.8.0). `JsonLd.tsx` follows the
// same plain-<script> + dangerouslySetInnerHTML pattern. Matching that
// precedent here rather than reintroducing next/script.
//
// Placement model (two-mode, driven by the `placement` prop) — unchanged from
// the prior model:
//   - `head` (default): GA4 loader + config, GTM bootstrap, Meta Pixel bootstrap
//     + its <noscript> pixel image, and any `customScripts` with
//     `placement !== 'bodyEnd'` (i.e. 'head' or unset).
//   - `bodyEnd`: the GTM <noscript> iframe, and any `customScripts` with
//     `placement === 'bodyEnd'`.
//   The canonical GTM recommendation places the <noscript> iframe immediately
//   after the opening <body> tag. The tenant layout's dual-branch structure
//   (Livener / generic) does not expose a raw <body>, so the iframe is instead
//   rendered as early as practical in the body content (right after
//   `<main>{children}</main>` in each branch) via the `bodyEnd` mode. This is a
//   deliberate, documented deviation from the textbook GTM snippet placement,
//   not an oversight.
//
// Verification meta tags (google-site-verification, msvalidate.01) are NOT
// handled here — they render unconditionally via `generateMetadata` regardless
// of environment (now sourced from siteConfig SEO fields, ADR-014 Phase B).
// Verification is independent of tracking: it is not visitor tracking.
//
// Custom scripts (the 'custom-scripts' integration, `values.scripts`) are an
// Abluo-platform capability for trusted, admin-vetted third-party integrations
// only — never exposed to the client dashboard. Selection (enabled/placement/
// consent) is delegated to the pure `filterCustomScripts` helper
// (`src/lib/tracking/custom-scripts.ts`), unchanged by this rewire.

interface TrackingScriptsProps {
  data?: ProjectIntegrations | null
  placement?: 'head' | 'bodyEnd'
}

export function TrackingScripts({ data, placement = 'head' }: TrackingScriptsProps) {
  if (!data || !isProduction()) return null

  const t = resolveTracking(data.integrationConfigs, data.privacy)

  if (t.killSwitched) return null

  const { ga4MeasurementId, gtmContainerId, metaPixelId, customScripts, consentModeEnabled } = t

  const scriptsForPlacement = filterCustomScripts(
    customScripts,
    placement,
    consentStateFor(consentModeEnabled)
  )

  const builtInsAllowed = builtInTrackingAllowed(consentModeEnabled)

  if (placement === 'bodyEnd') {
    return (
      <>
        {builtInsAllowed && gtmContainerId && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmContainerId}`}
              height={0}
              width={0}
              style={{ display: 'none', visibility: 'hidden' }}
              title="Google Tag Manager"
            />
          </noscript>
        )}
        {scriptsForPlacement.map((s, i) => (
          <script key={`tracking-bodyend-${i}`} dangerouslySetInnerHTML={{ __html: s.code! }} />
        ))}
      </>
    )
  }

  return (
    <>
      {builtInsAllowed && ga4MeasurementId && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga4MeasurementId}`} />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4MeasurementId}');`,
            }}
          />
        </>
      )}
      {builtInsAllowed && gtmContainerId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmContainerId}');`,
          }}
        />
      )}
      {builtInsAllowed && metaPixelId && (
        <>
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
            }}
          />
          <noscript>
            <img
              height={1}
              width={1}
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      )}
      {scriptsForPlacement.map((s, i) => (
        <script key={`tracking-head-${i}`} dangerouslySetInnerHTML={{ __html: s.code! }} />
      ))}
    </>
  )
}
