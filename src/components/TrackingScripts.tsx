import type { SiteConfigIntegrations } from '@/lib/sanity/types'
import { isProduction } from '@/lib/deployment'
import {
  filterCustomScripts,
  consentStateFor,
  builtInTrackingAllowed,
} from '@/lib/tracking/custom-scripts'

// ─── Tracking / Analytics Scripts ──────────────────────────────────────────────
//
// Renders GA4, GTM, Meta Pixel, and tenant custom scripts from
// `siteConfig.integrations` (Sanity — read-only here, owned by
// sanity-content-contracts). Production-only: analytics from dev/preview
// deployments would pollute tenant data (AI recommends — reversible).
//
// Two tenant-configurable master toggles gate this component (Sprint 1,
// Round 3 — `Tom decides` / verbatim rule for #1; Round 4 — `Tom decides` /
// verbatim rule settling #2, previously deferred):
//   1. `integrations.analyticsEnabled` (fail-closed, strict `=== true`): when
//      false or unset, GA4, GTM, Meta Pixel, AND all custom tracking scripts
//      do not execute, in both `head` and `bodyEnd` placements. This is a
//      single early return covering the whole component — there is no path
//      that renders any tracking output while this flag is not `true`.
//   2. `integrations.consentModeEnabled`: when `true` (no visitor-consent
//      mechanism exists yet, so this is treated as "no valid consent"), the
//      platform fails closed for EVERYTHING except Necessary custom scripts:
//        - GA4, GTM (including its bodyEnd noscript iframe), and Meta Pixel
//          are all suppressed via `builtInTrackingAllowed(consentModeEnabled)`.
//        - Custom scripts with `consentCategory` `analytics`/`marketing`/
//          `functional` are passed a fail-closed `ConsentState`
//          (`{ analytics: false, marketing: false, functional: false }`) via
//          `consentStateFor()`, so none of them render.
//        - Custom scripts with `consentCategory` `necessary` are unaffected —
//          they are Abluo-admin-approved by construction (admin-created,
//          `enabled === true`, required description + category) and are
//          never consent-gated.
//      "The consent feature ships later" is not permission to load tracking
//      without consent in the meantime — see `builtInTrackingAllowed` TSDoc
//      (`src/lib/tracking/custom-scripts.ts`) for Tom's rule verbatim.
//
// Uses plain <script> tags, NOT next/script. Precedent: `layout.tsx` previously
// used `<Script strategy="beforeInteractive">` in this same Server Component
// tree and it was replaced with a plain <script> for React 19 compatibility
// (see project history "React 19 Script fix", V0.8.0). `JsonLd.tsx` follows the
// same plain-<script> + dangerouslySetInnerHTML pattern. Matching that
// precedent here rather than reintroducing next/script.
//
// Placement model (two-mode, driven by the `placement` prop):
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
// of environment. Verification is independent of `analyticsEnabled`: it is not
// visitor tracking.
//
// Custom scripts (`integrations.customScripts`) are an Abluo-platform capability
// for trusted, admin-vetted third-party integrations only — never exposed to
// the client dashboard. Selection (enabled/placement/consent) is delegated to
// the pure `filterCustomScripts` helper (`src/lib/tracking/custom-scripts.ts`).
// The `ConsentState` passed to it is derived from `consentModeEnabled` via
// `consentStateFor()` — see toggle #2 above.

interface TrackingScriptsProps {
  integrations?: SiteConfigIntegrations
  placement?: 'head' | 'bodyEnd'
}

export function TrackingScripts({ integrations, placement = 'head' }: TrackingScriptsProps) {
  if (!integrations || !isProduction() || integrations.analyticsEnabled !== true) return null

  const { googleAnalyticsId, googleTagManagerId, metaPixelId, customScripts, consentModeEnabled } =
    integrations

  const scriptsForPlacement = filterCustomScripts(
    customScripts,
    placement,
    consentStateFor(consentModeEnabled)
  )

  const builtInsAllowed = builtInTrackingAllowed(consentModeEnabled)

  if (placement === 'bodyEnd') {
    return (
      <>
        {builtInsAllowed && googleTagManagerId && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${googleTagManagerId}`}
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
      {builtInsAllowed && googleAnalyticsId && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`} />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${googleAnalyticsId}');`,
            }}
          />
        </>
      )}
      {builtInsAllowed && googleTagManagerId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${googleTagManagerId}');`,
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
