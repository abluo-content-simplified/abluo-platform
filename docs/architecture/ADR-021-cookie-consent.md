# ADR-021 — Cookie Consent as a platform capability

**Status:** Proposed
**Date:** 2026-09-28
**Owner:** Tom
**Supersedes/relates:** ADR-013 (consent semantics — the "until the consent mechanism ships" interim), ADR-014 (Integration Registry, Privacy pane = the one configuration surface)

---

## Context

Every integration already declares a `consentCategory` and `TrackingScripts` already fails closed under `project.privacy.consentModeEnabled`. What never shipped is the mechanism in between: a banner, a stored visitor choice, and a real `ConsentState`. Today a tenant is in one of two states:

- `consentModeEnabled === true` → analytics/marketing/functional never load (legal, useless).
- `consentModeEnabled !== true` → everything loads with no consent (`consentStateFor()` returns `undefined`, `filterCustomScripts` does not gate) — **not compliant for EU visitors.**

Third-party embeds also set cookies with no gate: YouTube and Vimeo iframes in `VideoSection.tsx`, Google Maps in `ContactSection.tsx`.

Legal baseline (not legal advice): ePrivacy Directive Art. 5(3) + GDPR consent, enforced nationally. We build to the Italian Garante's 2021 cookie guidelines (the enforcer for most tenants, and aligned with the EDPB), and we design ahead for the Digital Omnibus proposal (GDPR Art. 88a/88b, still in negotiation): per-purpose refusal memory ≥ 6 months, browser privacy signals, and exempt first-party audience measurement.

Build vs buy: Cookiebot and iubenda bill per domain, per month. Our registry already knows exactly what each site loads, so we build it ourselves.

## Decision

1. **Consent is not a module and not a toggle.** Whether the banner shows is *derived*: `requiresConsent(project)` returns true iff at least one enabled integration has a gated category (`analytics | marketing | functional`). No tracking means no banner. There is no switch to turn the banner off while tracking is on. The `consentModeEnabled` field is retired: gating is always on. `trackingKillSwitch` stays.
2. **One registry drives everything.** The banner categories, the policy version and (later) the cookie policy all derive from `INTEGRATION_REGISTRY` plus the enabled configs. Nothing is hand-written per tenant.
3. **The banner inherits the site's look.** It is a first-party component styled only from Design System CSS variables already emitted by `buildCssVars()`, and it animates with the motion tokens. No new DS fields are needed for v1.
4. **The choice is remembered, not nagged.** A decision (accept, reject or custom) is stored in a first-party, strictly-necessary cookie and respected for **12 months**. We re-ask earlier only for a purpose that has *changed*, and never for a purpose the visitor refused within the last 6 months.
5. **Embeds are consented at the point of use.** They get a click-to-load placeholder, so a site whose only third-party content is a YouTube video needs no banner at all.

## Remembering the choice — legal floor vs our choice

What the law requires (Garante 2021, the Omnibus Art. 88a proposal):

- **Closing with the X means "reject".** This is an explicit Garante requirement: closing the banner keeps the defaults, and only technical cookies are set.
- **After a refusal (including the X), the banner may NOT be shown again for at least 6 months.** This is a *minimum wait*, not a maximum. The only exceptions are:
  - the processing conditions change significantly (for example a new third party or a new purpose);
  - the site cannot know the earlier choice (for example the visitor cleared their cookies).
- **There is no legal maximum on how long an acceptance lasts** in the Garante guidelines. Other regulators suggest renewing within about 13 months.
- **Scrolling or continuing to browse is never consent.**

What we choose (Tom's requirement: no nagging):

- Accept, reject or custom → no banner for **12 months** on that site. That sits above the 6-month floor and under the ~13-month ceiling other regulators use.
- The X is recorded exactly like "Reject all" and remembered for 12 months.
- Early re-ask happens only for a purpose whose vendors changed:
  - **accepted purpose + changed vendors** → ask again now;
  - **refused purpose + changed vendors** → ask again only after 6 months have passed. We deliberately do not use the Garante's "significant change" exception, so we also satisfy the stricter Omnibus rule.
  - **purpose never asked about** → ask.
- "Cookie settings" in the footer is the only way the panel re-opens on its own site.

## Garante / EDPB UI rules the banner must satisfy

- "Accept all" and "Reject all" have **identical visual weight**: same button style, size and colour. No primary/secondary split between them.
- "Customize" opens per-category toggles. `necessary` is shown on and locked; everything else defaults off (no pre-ticked boxes).
- The X closes the banner as a reject. Scrolling or continued navigation is never consent.
- No cookie wall: the page stays usable under the banner.
- A link to the tenant's privacy/cookie policy is visible in the first layer.
- There is a permanent withdrawal path (the footer link), and withdrawal is as easy as giving consent.

---

## Plan — step by step

Each phase ships on its own and leaves production deployable (ADR-007). Phase 1 is the "pops up ASAP" milestone.

### Phase 0 — Close the open gap today (data only, no deploy)

- Audit production Sanity: `*[_type == "project" && count(integrationConfigs[enabled == true]) > 0]{projectSlug, "consent": privacy.consentModeEnabled}`.
- For any project with tracking enabled and `consentModeEnabled != true`, Tom decides per tenant: switch consent mode on (tracking stops until Phase 1) or accept the gap for a few days.
- This only flips an existing field the deployed code already reads. It is not a shape migration, so it does not conflict with the never-migrate-ahead-of-deploy rule.

### Phase 1 — The banner + Google Maps placeholder (MVP)

Both live sites (Livener, Studio Martegani) have GA4 enabled with no consent and a Google Map in `ContactSection`. Phase 1 therefore also includes the click-to-load placeholder for the **map**; YouTube/Vimeo stay in Phase 2.

**Pure core — `src/lib/consent/`** (vitest, no React)

**Status: BUILT 2026-09-28** — `src/lib/consent/` (types, policy, cookie, decide) + 19 vitest tests; tsc clean.

- `types.ts`: `ConsentRecord { v: 1; purposes: { analytics?, marketing?, functional?: { granted, decidedAt, fingerprint } }; vendors: { [id]: { granted, decidedAt } } }`. There is no global policy version: each purpose carries a fingerprint of its vendors, which is what makes "accepted vs refused purpose changed" decidable.
- `cookie.ts`: parse and serialize. The cookie is **`abluo_consent_<projectSlug>`**, `Path=/`, `SameSite=Lax`, `Secure`, `Max-Age` 12 months.
  - The name is per project because `preview.abluo.app/<tenant>` serves several tenants on one host.
  - Corrupt or unknown input returns "no record", which fails closed.
- `policy.ts`:
  - `deriveConsentPolicy(projectIntegrations)` reuses `resolveTracking()`, so the kill switch and blank-value rules match `TrackingScripts`. Custom scripts are gated by their own category.
  - `requiresConsent(policy)` returns whether the banner exists at all.
- `decide.ts`:
  - `shouldShowBanner`, `grantsFrom` (replaces the synthetic `consentStateFor()`), `applyChoice`, `acceptAll`, `rejectAll` (also used by the X).
  - `vendorAllowed` / `allowVendor` for click-to-load embeds.

**Status: slice 1b BUILT 2026-09-28** (uncommitted on `dev`):

- `lib/consent/server.ts` (`readConsentContext`), wired into both tenant-layout branches.
- `TrackingScripts` is now gated per integration by the visitor's real grants.
- `components/consent/`: `ConsentProvider`, `CookieBanner`, `CookieSettingsLink` (in the footer), `ConsentEmbed` (the Google Maps placeholder in `ContactSection`).
- `i18n/consent-messages.ts` covers 7 locales.
- `privacy.cookiePolicyPage` is in the schema and in `projectConsentQuery`.
- 23 consent tests; the full suite is 2249/2249; tsc is clean.

Remaining for Phase 1:

- The Privacy pane UI for `cookiePolicyPage`, plus the read-only "banner active because…" line.
- Hiding `consentModeEnabled` in the Studio.

**Server wiring**

- Tenant `layout.tsx` (both branches) reads the cookie (the routes are already `force-dynamic`) and computes `ConsentState` + `showBanner`.
- `TrackingScripts` receives the real `ConsentState`:
  - `builtInTrackingAllowed` becomes per-category: GA4 → analytics, GTM → analytics, Meta Pixel → marketing, taken from each manifest's declared category.
  - `consentStateFor()` and the "undefined means don't gate" interim branch are deleted. There is always a `ConsentState`, and "no record" means all gated categories are false.
- **v1 decision (built):** when a visitor *grants* a purpose, the page reloads once and the server renders the scripts — one code path for loading tracking, no client-side injection. Rejecting or closing never reloads. Production-only gating stays as it is.

**The banner — `src/components/consent/CookieBanner.tsx`** (client)

- Layout: a bottom panel. It is full-width on mobile; on desktop it is a max-width card inset from the edge. It is non-blocking, `role="dialog"` with `aria-modal="false"`, keyboard reachable, and focus-visible.
- Styling uses DS variables only:
  - `--color-surface`, `--color-text-primary`, `--color-text-secondary`, `--color-border`
  - `--radius-lg` for the card; `--font-heading` and `--font-body`, `--typo-small`
  - Both Accept and Reject buttons use the *same* token set (`--btn-secondary-*` + `--radius-btn`, identical weight).
  - It respects the light/dark theme automatically, because those variables already switch.
- Motion: `AnimatePresence` + `motion.div` with `--motion-duration-base` / `easingDecelerate`. No raw keyframes.
- Two layers:
  1. Short text + policy link + [Reject all] [Accept all] + "Customize" + X.
  2. Only the categories in use, each with a localized one-line purpose and the vendor names from the registry (e.g. "Statistics — Google Analytics").
- Copy: `src/lib/i18n/consent-messages.ts` → `getConsentMessages(locale)` for every locale in `routing.ts`. Nothing is hardcoded.
- Policy link: a new optional `privacy.cookiePolicyPage` (a reference to a `page`) on the Privacy pane, the one configuration surface. When it is unset, the link is hidden and the Privacy pane shows a warning.

**Footer:** a "Cookie settings" link (localized) reopens layer 2. It renders only when `requiresConsent` is non-empty.

**Environments:** the banner renders on dev and preview too, so Tom can review it; scripts stay production-only. `?consent=reset` clears the cookie on non-production hosts for QA.

**Studio (read-only):** the Privacy pane shows "Cookie banner: active — because Google Analytics (analytics), Meta Pixel (marketing)" or "not needed". `consentModeEnabled` is hidden, and its schema removal follows *after* this deploy is live.

**Tests:**

- Cookie round-trip and corrupt input.
- `shouldShowBanner` across the 12-month, 6-month and policy-change matrix.
- `requiresConsent` with 0, 1 and n integrations and with the kill switch on.
- `TrackingScripts` renders nothing gated with no record.
- An X-close is treated as a reject.

**Done when:** a tenant with GA4 enabled shows the banner in its own DS look on preview. Rejecting keeps GA4 out of the network tab. Accepting reloads once and then loads it. The banner does not come back on reload or next visit. The footer link reopens it.

### Phase 1 close-out — *BUILT 2026-09-28*

- **Privacy pane (Studio).**
  - The "Consent Mode Enabled" switch is removed from the UI; consent is always enforced.
  - The pane now shows *"Cookie banner: active — because <vendors> (<purpose>)"* or *"not needed"*.
  - It has a **Cookie policy page** picker. The stored reference is weak, so a page that is still a draft can be chosen now; the link appears once that page is published.
- **Links to unpublished pages are hidden.** `NAV_LINK_FIELDS` projects `hasPageRef`, and `isRenderableNavLink()` drops internal links whose page is not published. Previously such a link silently pointed at the home page. Links can now be prepared in advance and appear when the page is published.
- **`cookieSettings` link type (footer only).** An editor can place "Cookie settings" in a footer column (e.g. under Legal). When they do, the automatic one in the bottom bar is not repeated.
- **Banner text stays platform-owned** (decided 2026-09-28). There is no per-site override for now.

**Data (production dataset, 2026-09-28):**

- `privacy.cookiePolicyPage` is set (weak) on hoffmann → `hoffmann-page-cookie-policy` (published), livener → `livener-page-cookie-policy` (draft) and studiomartegani → `studiomartegani-page-cookie-policy` (draft).
- There are empty **draft** pages `livener-page-{privacy,cookie}-policy` and `studiomartegani-page-{privacy,cookie}-policy`.

**After this code is on production — data still to add (never before the deploy):**

1. Livener and Studio Martegani `siteConfig.footerLinks`: Privacy Policy + Cookie Policy (internal, weak `pageRef` to the draft pages). They stay hidden until the pages are published.
2. Hoffmann footer column "Legale": add a `cookieSettings` link ("Impostazioni cookie" / "Cookie-Einstellungen").

### Phase 1.5 — Withdrawable embeds + self-hosted fonts — *BUILT 2026-09-28*

- **Embed withdrawal.**
  - The footer "Cookie settings" link also appears when the visitor has allowed an embed. Before this, a site with no tracking (e.g. Hoffmann) had no way to take back "Always allow Google Maps".
  - The settings panel lists the allowed embeds under "External content", each with a switch.
  - "Reject all" withdraws them too.
- **Self-hosted Google Fonts.**
  - Tenant pages load fonts from `/api/fonts/css` and `/api/fonts/file/*` on the site's own host, instead of `fonts.googleapis.com` / `fonts.gstatic.com`. Visitors' IP addresses no longer reach Google, which was the finding of LG München, 20 Jan 2022.
  - Our server fetches from Google once and the CDN caches the result: CSS for 30 days, font files as immutable.
  - The endpoints validate their input and are not an open proxy.
  - The Studio's Design System Preview (admin-only) still uses Google directly.

### Note 2026-09-30 — Locations section maps

Maps have no banner category: like every embed they are consented per vendor at the point of use (Decision 5). The Locations section's live maps (`locationsSection.showMap`, default on) reuse `ConsentEmbed` with the same vendor id `google-maps` as the Contact section, so one "Always allow Google Maps" covers both, and the footer settings withdraw both. Before consent the server HTML contains the placeholder only, no iframe (tested in `locations-map.test.tsx`). `ConsentEmbed` gained optional `aspectRatio` and `labels` props so a section can supply its own localized copy ("Show map").

### Phase 2 — Video embeds (click-to-load)

- A `ConsentEmbed` wrapper for `VideoSection` (YouTube, Vimeo) and the `ContactSection` map. Before consent it shows a DS-styled placeholder: "This content is hosted by YouTube, which sets cookies. [Load video] ☐ Always allow YouTube". Use `youtube-nocookie.com` once loaded.
- Per-vendor "always allow" is stored in the same consent record (`vendors: { youtube: {granted, decidedAt} }`).
- Cloudflare Stream: verify whether it sets any non-essential cookie. If it sets none, it is exempt.
- **Decision for Tom:** embed consent is per vendor, not a banner category. That keeps the banner away from embed-only sites.

### Phase 3 — Proof of consent + Google Consent Mode v2

- A Supabase migration adds `consent_records(id, project_id, consent_id uuid, policy_version, choices jsonb, source 'banner'|'settings'|'embed', created_at)`.
  - `consent_id` is a random id stored in the consent cookie.
  - No IP and no user-agent fingerprint.
  - Retention is 24 months, with a scheduled purge.
- `POST /api/consent/[projectSlug]`: write-only, rate-limited, fail-closed, following the same isolation pattern as the forms API. A logging failure never blocks the visitor's choice.
- Google Consent Mode v2 in **basic** mode: `gtag('consent','default', all denied)` before any Google tag, then `update` on grant. Tags still don't load before consent. Advanced mode (cookieless pings before consent) is not used.

### Phase 4 — Generated cookie policy

- The integration manifests gain `vendor`, `cookies[] { name, duration, purpose (localized) }` and `privacyUrl`. The same declarations are added for embed vendors.
- A `cookiePolicyTable` block, which the tenant's cookie-policy page renders. It is generated from the enabled integrations, so it can never drift from what the site actually loads.
- `policyVersion` also covers the cookie list, so a new cookie in an accepted purpose re-asks (Phase 1 rules).
- A lawyer reviews the template text once.

### Phase 5 — Omnibus readiness (when Art. 88a/88b pass)

- Honour browser signals: `Sec-GPC: 1` / `navigator.globalPrivacyControl` is treated as a refusal of analytics and marketing, with no banner shown for those purposes.
- Offer a first-party, cookieless audience-measurement integration (category `necessary`/exempt) so that tenants who don't need GA4 have **no banner at all**.
- Revisit the 12-month validity against the final text.

### Phase 6 — Legal regime per site: EU (default) or UK — *proposed, not yet decided*

Which rules apply depends on where the site owner is established and which visitors the site targets, not on where the servers are. The site owner is the controller; Abluo is the processor.

UK sites fall under UK GDPR + PECR, enforced by the ICO. The Data (Use and Access) Act 2025 amended PECR from 5 February 2026:

- **Statistical (analytics) cookies** and **appearance cookies** no longer need consent. The site must give clear information and a simple, free way to opt out.
- **Marketing cookies and third-party embeds** still need consent.
- **Fines** now reach £17.5M or 4% of global turnover.

The EU/Garante regime is stricter, so it is also lawful in the UK. It stays the default for every site.

If adopted:

- Add `privacy.legalRegime: 'eu' | 'uk'` (default `eu`) to the Privacy pane.
- Under `uk`:
  - `analytics` starts as granted without a banner. Instead there is a short info notice plus a permanent "Opt out of statistics" link in the footer.
  - `marketing` and `functional` follow the EU flow.
  - Embeds stay click-to-load.
- The consent core already supports this: it is a different starting default for one purpose, with no change to the record format.
- **Caveat:** whether GA4 qualifies as "solely statistical" depends on its configuration (no Google Signals, no ads linking, no use by Google for its own purposes). The site owner's adviser should confirm this.
- A UK-regime site that actively targets EU visitors must still apply the EU rules to them. In that case, keep it on `eu`.
- First candidate: Livener (UK company).

---

## Consequences

- Every tenant with tracking becomes compliant by construction. Adding GA4 to a site switches its banner on, and there is nothing to forget.
- `consentStateFor()`, the "undefined = don't gate" interim branch in `filterCustomScripts`, and `privacy.consentModeEnabled` are retired: the code is removed in Phase 1 and the field after deploy.
- The banner adds one client component and one cookie read per request. The tenant routes are already dynamic, so there is no caching regression.
- There are no per-domain third-party fees and no third-party CMP script on client sites.

## Phase 0 result (2026-09-28)

Production audit: `livener` and `studiomartegani` have `google-analytics` enabled and `consentModeEnabled` unset, so GA4 loads without consent. `abluo`, `hoffmann`, `nologo` and `tmz` have no tracking. Tom decides whether to flip `consentModeEnabled` on the two live sites before Phase 1 ships.

## Decisions (defaults taken 2026-09-28, Tom may override)

1. Accept and Reject both use the DS *secondary* button style.
2. Position: a bottom-left card on desktop, full-width on mobile.
3. Embed consent is per vendor (placeholder), not a banner category.

## How to test (Phase 1)

- **Unit (vitest, fake clock):** every time rule — 12-month expiry, 6-month refusal floor, changed vendors on accepted vs refused purposes, corrupt cookie, the X = reject path. These are the only place the 6/12-month rules can be tested for real.
- **Preview, by hand** (the banner renders on preview; GA itself is production-only):
  1. Open `preview.abluo.app/<tenant>?consent=reset` → the banner appears in the site's look.
  2. DevTools → Application → Cookies: `abluo_consent_<projectSlug>` is absent.
  3. Click the X → the banner closes, the cookie is written with every category `granted:false`. Reload → no banner.
  4. Footer "Cookie settings" → the panel opens with the saved choice; switch Statistics on and save → the cookie updates. Reload → no banner.
  5. Contact page: the map shows the placeholder. Network tab filter `google` → no request. Click "Load map" → the map loads. "Always allow" → the next visit loads it directly.
  6. Early re-ask: in DevTools, edit the cookie's `decidedAt` back 13 months → reload → the banner returns.
- **Production smoke after deploy:** reject → the Network tab shows no `googletagmanager.com` request; accept → one reload → `gtag/js` loads.
