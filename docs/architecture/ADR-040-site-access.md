# ADR-040 — Site Access (restricted pages and protected files)

**Status:** Accepted (2026-10-24 — architecture approved by Tom after the Stage A audit; B1, B2.0 and B2.1 implemented; B2.2 pending approval)
**Date:** 2026-10-24
**Owner:** Tom
**Supersedes:** ADR-024 (Members area module, Proposed 2026-09-30, never implemented)
**Relates:** ADR-014 (one configuration surface), ADR-015/017 (`TenantAuthorizationContext`, `assertModuleAction`), ADR-018 (forms — rate-limit pattern, `extractIp`), ADR-021 (consent — the access cookie is strictly necessary), ADR-028 (roles & permissions; reserves `members.*`), ADR-029/030 (dashboards), ADR-032 (content lifecycle), ADR-034 (canonical host), ADR-039 (private bucket + signed URLs precedent), `docs/engineering/sanity-private-dataset.md`, Component Lab rules (CLAUDE.md)

---

## Context

Tenants need to restrict selected website resources to selected audiences. First case: CYCE (yoga association, EN + FR) publishes a monthly **timetable PDF** that only members may open, today behind one shared password on Webflow. CYCE may need several independent audiences (Members, Teachers, Staff, more), a resource readable by several of them, and later individual accounts. Future tenants: client portals, staff-only pages, private teaching material. Patient-specific records (Hoffmann) are explicitly **out of scope** (§12).

This must be a platform capability, configurable per project without code, and it must grow to individual identities and passkeys without rebuilding the protection layer.

## 1. Verified facts this ADR builds on (2026-10-24)

| Fact | Evidence |
|---|---|
| Both Sanity datasets are **private** since 2026-10-11 | `sanity-private-dataset.md` status; anonymous query returns empty |
| Sanity **assets stay public**: CDN URLs work without a token and are cached a year | anonymous `HEAD` on a CYCE PDF → `200`, `cache-control: public, max-age=31536000, s-maxage=2592000` |
| Sanity attribute budget: **3,342 / 10,000** (Growth plan) in `production`, 15 in `staging` | `GET /v1/data/stats/<dataset>` → `fields.count` |
| Every `(website)/[tenant]` route is `force-dynamic`; `next.config.ts` sends `Cache-Control: no-store` on `/(.*)` (since B2.3: `private, no-store`) | source |
| `src/proxy.ts` never sees `/api/*` (matcher excludes it) | `config.matcher` |
| The host → project table carries the stable `projectId` | `src/lib/tenancy/generated/route-config.ts`, `resolveScopeFromHost()` |
| Private Supabase Storage works as expected: unsigned `/object/public/…` and `/object/…` → `400`; a signed URL → `200` (no `cache-control`, `cf-cache-status: MISS`); the **same signed URL after expiry → `400`** | live check on `support-attachments`, 2026-10-24 |
| Buckets in use: `avatars` (public, 3 MB), `product-updates` (public, 5 MB), `support-attachments` (private, 5 MB) | Storage API |
| Server actions accept 4 MB bodies (Vercel 4.5 MB request limit) | `next.config.ts` |
| Dev, preview and production share **one** Supabase project | Tom, 2026-10-20 |
| Supabase WebAuthn has one project-wide relying party (`abluo.app`) → cannot serve passkeys on tenant domains | `claude/passkeys-phase1-investigation-2026-10-15.md` §2 |

## 2. What changed from ADR-024, and what carried over

**Carried over:** shared-password hashing with scrypt; secrets only in Supabase (never Sanity); private bucket + short signed URLs; rate limiting counted in SQL over salted IP hashes, fail closed; `__Host-` cookie, strictly necessary under ADR-021; codes, never sentences, from the API; multilingual document titles in Supabase; the `members.*` permission prefix; visitor identity kept apart from `auth.users`; noindex / sitemap / llms.txt exclusion.

**Changed:**

1. **Groups, credentials and resources are separate.** ADR-024's "area" was audience + password + container in one. Now: a credential *grants* one or more groups; a resource *allows* one or more groups (§4).
2. **Server-side sessions** with live group resolution instead of a stateless HMAC cookie (§6). Revocation, rotation, group changes and archiving take effect on the next request. No cookie secret exists.
3. **Restricted pages are gated server-side.** ADR-024 rejected route gating because pages were static and page text was public in Sanity. Both premises are gone (§1).
4. **Tenants manage everything in the tenant dashboard** from day one. No Studio pane (Studio is super-admin only, Tom 2026-10-17).
5. **No attribute constraint.** ADR-024 assumed a 2,000 limit with a dozen paths left; the dataset is at 3,342 of 10,000.
6. Migration number 050 (ADR-024's 028 was used for security hardening). Table prefix `site_access_` — `access_audit_log` (049) already means *dashboard* access.

## 3. Two identity planes

| | Dashboard plane | Visitor plane (this ADR) |
|---|---|---|
| Who | Owners, Project Admins, Editors, Abluo staff | Website visitors |
| Identity | Supabase Auth user | none in Phase 1; `site_access_subjects` in Phase 2 |
| Session | Supabase session cookie | `__Host-abluo-access-<project>` → `site_access_sessions` |
| Decides | who may **manage** access (`can()`, `assertModuleAction`) | who may **open** a restricted resource (`evaluateAccess`) |

Nothing on the visitor plane is a Supabase Auth user, carries a JWT, or can produce a `TenantAuthorizationContext`. **Holding a shared password never grants any CMS permission**, and a dashboard role never opens a restricted page on the website (dashboard users preview through the existing draft-preview path). `src/lib/access/__tests__/store-contract.test.ts` enforces that no site-access file touches the dashboard session layer.

## 4. Data model and authorization semantics

Migration `050_site_access.sql` (additive; RLS on, no policies, no grants to `anon`/`authenticated`; atomic writes are `SECURITY INVOKER` functions executable by `service_role` only — the 046 pattern):

| Table | Holds |
|---|---|
| `site_access_groups` | audiences; localized `name` jsonb; archived, never deleted |
| `site_access_credentials` | `kind = 'shared_password'`, admin-only `label`, `secret_version`, optional `expires_at`, `disabled_at` |
| `site_access_credential_secrets` | the scrypt hash, alone in its table |
| `site_access_credential_groups` | credential ⇄ group (N:M) |
| `site_access_sessions` | sha256 of the cookie token, expiry, revocation reason |
| `site_access_session_grants` | (session, credential, version typed); `subject_id` reserved for Phase 2 |
| `site_access_attempts` | rate-limit store, salted IP hashes only |
| `site_access_documents` / `_document_files` / `_document_groups` | protected documents, one PDF per locale, allowed groups |
| `site_access_events` | management audit trail — never a secret |

**Isolation is in the schema.** Every link table carries `project_id` and uses composite foreign keys `(id, project_id)`: a credential cannot open another project's group, a grant cannot point at another project's credential, a document cannot allow another project's group, a file path must start with its own project id. Proven in `supabase/verify/hardening-050.verify.mjs`.

**Semantics** (`src/lib/access/policy.ts`, the one decision function):

- A resource is `public` or `restricted` to a set of groups.
- **OR** within a resource: one matching group is enough.
- **AND** along a chain (page → section → file, later): every restricted link must be satisfied. A child can never be less restricted than its parent; there are no widening overrides.
- **Deny by default:** restricted with no groups → nobody; an id that is not one of the visitor's *live* groups of *this* project grants nothing (archived, foreign, invented); a malformed `access` object restricts to nobody; the module being off denies every restricted resource — it never makes it public; any store error is "no session".
- Groups are resolved **live**: `site_access_resolve()` returns a grant's groups only while the credential is enabled, unexpired and still at the version that was typed, and the group is not archived.

**Operational limits per project:** 100 groups, 50 passwords, 500 documents, 20 grants per session (database triggers).

## 5. Shared passwords

- scrypt N = 2^15, r = 8, p = 1, 16-byte salt, stored `scrypt$N$r$p$salt$hash`; parameters read back are bounded so a corrupt row cannot burn the CPU. NFKC-normalised. Constant-time compare; one dummy verification when there is nothing to verify.
- Policy: 10–200 characters. **Unique per project** — a duplicate would make rotation ambiguous.
- Never stored or logged in clear, never returned, never shown again.
- **Rotation on demand** (not seasonal — Tom): new hash, `secret_version + 1`, every grant from the old password is deleted and sessions left with nothing are revoked (`credential_rotated`). Other grants in the same session survive.
- **Disabling** drops grants the same way; re-enabling never brings old sessions back.
- A prompt checks only passwords that can help with the resource in front of it (`groupsRelevantTo` → `site_access_candidate_credentials(project, groups)`), all of them, without early exit.

## 6. Sessions

- Cookie `__Host-abluo-access-<first 12 hex of project id>` (no prefix on plain-http localhost): `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age = 30 days`. One per project, so projects sharing a path-routed host (`dev.abluo.app/<p>`, `preview.abluo.app/<p>`) never clobber each other; the lookup is *also* keyed on the project server-side.
- Value: 32 random bytes, base64url. Only the sha256 is stored. A database leak yields no usable cookie.
- **Fixation:** every successful unlock replaces the token of the current session (same project only) or starts a new one; a planted or foreign token is never adopted.
- Logout revokes one session; Access → "Sign out everyone" revokes all of the project's; admins can revoke one device.
- `site_access_resolve()` is the single read per protected request (`last_seen_at` touched at most every 5 minutes).
- The project id always comes from the **request host** (`resolveScopeFromHost`), never from a body, query string or cookie.
- **Environment-bound (B2.0).** dev, preview and production share one Supabase project, so every session row carries `environment` ∈ `production | preview | dev | local` and resolves only there; an unlock never rotates or extends a session of another environment. The identifier comes from Vercel's **runtime** variables (`src/lib/access/environment.ts`): `VERCEL_ENV=production` → production; `VERCEL_ENV=preview` on branch `preview` → preview, on any other branch → dev; not on Vercel or `vercel dev` → local. On Vercel with `VERCEL_ENV` (or, for previews, `VERCEL_GIT_COMMIT_REF`) missing or unknown the environment is `null` and the module **fails closed**: no unlock, no session resolves. The build-time `NEXT_PUBLIC_VERCEL_ENV` is ignored because it silently defaults to `development`.
- **What stays shared across environments (deliberately, project-level):** groups, passwords (rotating or disabling a password on dev affects production), documents, the audit trail and the rate-limit counts (stricter, not looser). "Sign out everyone" signs out every environment. Testing on dev therefore changes real project data — the platform rule in `docs/engineering/shared-environments.md`.

## 7. Rate limiting

Layered, decided **atomically in the database** (`site_access_reserve_attempt`), salted IP hashes (`ACCESS_IP_SALT`), IPv6 cut to /64:

1. per IP on this project: 5 failures / 15 min;
2. per IP across all projects: 30 / 15 min;
3. per project: ≥ 50 failures / 15 min puts the project *under pressure* and tightens (1) to **2 — never 0**.

**Atomic reservation (B2.0).** The B1 review showed that count-then-check-then-record let 20 of 20 parallel guesses from one IP be checked. Now one database call takes a transaction-scoped advisory lock on the IP hash, counts, and either refuses (writing nothing) or inserts a **pending** attempt — before any password is checked. A wrong password finishes it as failed (`site_access_finish_attempt`); the unlock marks it succeeded in its own transaction. Pending counts as a failure; like a failure it stops counting when it leaves the 15-minute window, so an abandoned reservation (function timeout, crash) can block nobody for longer than one window, and the purge removes it later. Regression-tested on six parallel connections (exactly 5 of 20 allowed), and a mutation check confirms the test fails without the lock.

There is deliberately **no global lockout** that an attacker could use to keep members out. Visitors holding a session are never rate-limited (resolving does not consult attempts). A failed reservation → `try_later` (fail closed); missing salt → `unavailable`. With shared passwords a guess cannot be attributed to one credential, so "per credential" is realised as per project.

## 8. Management (tenant dashboard)

Module id **`members`** (the ADR-028 reservation), shown to people as **"Access"** (`clientDashboard.nav.members`: Access / Accesso / Zugang). Registered in `MODULE_REGISTRY` (B2.1): no Sanity types, sections, collections or config (`configSchema: []` — the one configuration surface is the dashboard, ADR-014), `dataStore: hybrid`. Permissions: `members.access.read`, `members.access.manage` — Owner and Site admin by default (manifest `defaultRoles: ['owner']`, which `moduleRoleFor` gives Site admins too); Editors only as extras through the existing People flow (`GRANTABLE_MODULE_PERMISSIONS` + migration `051_site_access_grantable.sql`; manage requires read; honoured only while the module is enabled; an Owner can only give what they hold).

**Lifecycle.** Install, enable and disable are the standard Studio installation record (`moduleInstallations[]`, super admin). That record is the only thing they change: nothing in Supabase is created or deleted, restricted resources stay closed while the module is off (`module_unavailable`), management is refused while it is off (`assertModuleAction` checks the installation first) and passwords stop opening anything. A test asserts that no code outside `src/lib/access/` touches `site_access_*` data and that the store has no delete path; destructive cleanup of a project's access data is a separate, explicitly authorised operation that does not exist yet.

**Support mode.** `members.access.read` while viewing (support can see which groups exist and which pages they protect). **`members.access.manage` is never available to Abluo support, even with the client's live edit approval** (Tom, 2026-10-24): it is in `SUPPORT_NEVER_WRITES` (`src/lib/support/state.ts`), so it is removed server-side from every support `mutation` context by `supportPermissions()` and refused again at the point of use by `supportRefuses()` inside `assertModuleAction` — not merely hidden in the UI. Because groups and passwords share one permission, support also cannot create or rename groups; that is the deliberate, conservative reading. Every other approved support capability is unchanged. Exceptional credential assistance, if ever needed, requires a **separate, explicitly authorised and audited mechanism** — never this flag or a widened support role. `authorizeAccessManagement(ctx, projectId, level)` runs `assertModuleAction` and returns a grant **bound to one project**; every management function takes the grant, never a project id, and support never sees a password.

**The Access screen (B2.5, `/{project}/access`, Component Lab only).** Written so a non-technical administrator manages access the way they manage any other content — everyday words, one sheet per task, every consequence said before it happens and confirmed after:

- **Groups** — a group is created *with* its password in one sheet (name + password, "Suggest a password", Show/Hide); the password is checked before anything is written, so a refused password never leaves a half-made group. The dashboard keeps one password per group (labelled with its name) — the model still allows one password for several groups and several passwords per group; those show and can be changed. **Change password** says beforehand how many visitors are signed in with the current one and will be signed out, and the toast says how many were. Right after a password is set it is shown **once**, to copy and share; nothing stores or re-displays it (only scrypt hashes exist; no screen, action or log carries a password or hash). Rename; archive (confirmed; stops opening anything at once; restorable).
- **Documents** — "Add document" is one sheet: name, PDF, language (only on multilingual sites), who can open it. The PDF goes straight from the browser to the private bucket (B2.4 upload flow) with a progress bar; the browser pre-checks type and the 20 MB limit, the server re-checks the stored object. A document without a completed PDF is marked **Not available yet** with "Add the PDF" and "Remove" (remove = archive; a removed document that never had a PDF leaves the list) and never offers its link; the website refuses it exactly like an unknown document, even if the bytes of an unfinished upload already sit in storage (route test). Per language: replace (same link), add a missing language. Who can open it (none = nobody, said in place); copy the stable link (`https://<site>/<default locale>/site-access/documents/<id>`); rename; archive (confirmed; link stops working; restorable).
- **Pages** — every page of the site with who can see it; the home page is "Always public". "Change" opens Everyone / Only members of some groups → which groups → in the menu: hide / show with a lock. Written to the published page **and** its open draft in one transaction guarded by the revisions the screen saw (a page changed meanwhile → "changed somewhere else"); refused for the home page and for a page whose published or draft content has a "Download a file" button; groups must be live groups of this project. Nested pages say which page above closes them.
- **Signed in now** — "N visitors are signed in right now" (production sessions only; per group on the cards) from `site_access_session_summary` (**migration 053, unapplied**, counts only) and **Sign out everyone** (confirmed; the toast says how many).

Who sees what: the nav entry and the page need the module installed **and** `members.access.read`; otherwise 404. Changing anything needs `members.access.manage`; a support visit is read-only and every action refuses it (`support_mode`) before the store is opened. Every action re-resolves the caller (`resolveProjectAction`, mutation purpose), then `authorizeAccessManagement` — ids from another project are simply not found. While migrations 050/052 are not applied the screen shows "Access is almost ready" instead of an error; without 053 only the counts are hidden.

## 9. Pages (B2)

`page.access = { visibility, groups[], navigation }` in Sanity (Studio group **Access**) — 5 new attribute paths (`access`, `access.visibility`, `access.groups`, `access.groups[]`, `access.navigation`); budget verified (§1). Studio rules (`src/lib/access/page-schema-rules.ts`): hidden and invalid on the home page, at least one group id, no `fileDownload` CTA on a restricted page.

**Rule (one rule, two implementations that a test keeps equal).** A page is *open* iff `access` is absent or `access.visibility == "public"` — GROQ `pageIsOpen()` (`src/lib/access/groq.ts`) and `parseAccessPolicy()`; anything else, including a typo, is restricted (malformed → nobody). A page is readable only if it is open **and** no page whose slug is a path prefix of it is closed (D1: a child of a members page is a members page). Within one page the groups are OR; along the path they are AND.

**Gate (B2.2, delivered).** `loadGatedPage()` (`src/lib/access/page-gate.server.ts`) is the only code that runs `pageBySlugQuery`, used by `generateMetadata` and the page (React `cache()`, per request only):
1. `pageBySlugQuery` with `$unlocked: false` — for a restricted page Sanity returns routing data and the policy only; title, SEO, background and sections never leave Sanity (conditional projection `onlyWhenReadable()`).
2. `decidePageGate()` — an open page makes **no session lookup and no database call**. Restricted: module off or not resolvable → denied; unknown project → denied; then the visitor is resolved for the **request's** project and environment (`resolveVisitor`; any error → no visitor) and `evaluateAccess` decides. GROQ and TypeScript disagreeing → denied.
3. Only when granted, the same query with `$unlocked: true`, and only if it returns the same `_id`.

**Denied response.** The normal site chrome with `RestrictedPage` (no page props, no Sanity imports; B2.3 adds the password form): no sections, no hydration, no FAQ/JSON-LD. Metadata: `"<Members only> — <site>"`, no description, no canonical or hreflang, Open Graph without page image, robots `noindex, nofollow, noarchive, noimageindex`. A granted page keeps its metadata but is always `noindex` too. The home page cannot be restricted: its route never reads `access`, and the slug route 301s a home page to the root before the gate renders anything.

**HTTP status — TEMPORARY implementation decision (Tom, 2026-10-24: option A, provisional).** The approved design said 401. In Next.js 16.2.6 `unauthorized()` / `forbidden()` still require `experimental.authInterrupts`, and no experimental feature is adopted only to obtain a status code. Denied pages answer **200** with robots `noindex, nofollow` (meta) and `Cache-Control: private, no-store` (global header in `next.config.ts`, every path; the routes are `force-dynamic`). **This is not the final architecture.** Before production launch, reassess whether a stable, supported way exists to return 401 while keeping the inline password prompt; change only if neither content security nor the visitor experience is compromised. Rejected for now: enabling `authInterrupts` (experimental); `notFound()` → 404 (loses the in-place prompt).

**Listings.** Sitemap (`SITEMAP_PAGES_QUERY` projects `open`; images only for open pages) and llms.txt (`LLMS_PAGES_QUERY` reads titles/descriptions only for open pages) drop closed pages and everything under them per language (`src/lib/access/listing.ts`). Navigation (`NAV_LINK_FIELDS` projects the target's `access{visibility, navigation}` and `pageUnderClosed`, never its groups or content): hidden by default, or shown with a lock icon + localized screen-reader label (`NavLinkText`); children, footer links and the footer credit go through the same filter. Internal links and CTAs to a restricted page carry only its slug (no projection dereferences a page reference's content — test). `/api/v1` serves events only; no API route reads page documents (inventory test).

**Sign-in and sign-out (B2.3, delivered).** Two route handlers on the website itself, so the project comes from the website address exactly as for pages: `POST /{locale}/{project}/site-access/unlock` and `…/site-access/sign-out` (on a project's own domain the visible path is `/{locale}/site-access/…`; the proxy adds the project segment). `site-access` is a reserved slug. Logic in `src/lib/access/visitor-routes.ts`, pure checks in `src/lib/access/request.ts`:
1. **Strict same-origin POST** — `Origin` must be present and equal the request's own origin (`Host` + protocol; plain http only for local development); `Sec-Fetch-Site`, when sent, must be `same-origin`. Otherwise 403 before any other work. Cookies are `SameSite=Lax` on top.
2. **Project from the address** — the `[tenant]` segment must resolve to a serving project; on a project's own host the segment must be that project; the shared, path-routed hosts (`preview.abluo.app`, `localhost`, platform aliases such as `dev.abluo.app`) take the project from the path; any other host → 404. Never from the body.
3. url-encoded body ≤ 8 KB; **return path** must be relative, same-site and inside this site's base path (`/{locale}/{project}` on shared hosts, `/{locale}` on the own host), else the site's home.
4. unlock only: the Access module must be enabled for the project (Sanity read; unreadable → off).
Then the B1/B2.0 visitor plane: environment binding, atomic rate limit, scrypt against all of the project's passwords (the page then decides whether the resulting groups open it), token rotation. Success → 303 to the return path with the session cookie (`__Host-abluo-access-<project>`, Secure, HttpOnly, SameSite=Lax, Path=/, 30 days; no prefix/Secure on plain-http localhost). Failure → 303 back with `?access=wrong|wait(&wait=<minutes>)|unavailable`. Sign-out always clears the cookie with matching attributes. It says "You've been signed out" (`?access=signed_out`) only when the server CONFIRMED the revocation or there was nothing live to revoke; if revocation could not be confirmed (store error, undeterminable environment) it says "You've been signed out in this browser" (`?access=signed_out_browser`). **Residual risk:** in that case the session stays valid server-side until it expires (30 days) or is revoked from the dashboard ("sign out everyone"); someone who copied the cookie value before sign-out could still use it. `site-access` is refused as a page slug in Studio (no existing page used it — checked 2026-10-24). Every response `Cache-Control: private, no-store`.

**Prompt.** `RestrictedPage` renders `AccessPrompt` (plain HTML form — works without JavaScript; platform `PasswordInput` with reveal toggle; site design-system form and button tokens; `role="alert"` errors tied to the field, `role="status"` information). Notices speak only about the visitor: wrong password, too many attempts (with minutes), unavailable, access ended (a cookie that no longer opens anything — expiry, revocation, rotation, other environment or outage), signed in but this page needs another password (with a sign-out link), signed out. A granted members page ends with a small "Members area · Sign out" strip. All text from `getAccessMessages()` in the seven website languages.

**Public assets on restricted pages.** Images and files stored as Sanity assets stay publicly fetchable by URL. Decorative images may be used on restricted pages; the editor shows a warning that such assets are not private. `fileDownload` CTAs are refused on restricted pages. No sensitive document may ever be a Sanity asset.

## 10. Protected files (B2.4)

**Storage.** Private bucket `site-access-files` (050): PDF only, 20 MB; the Supabase project-wide upload limit is 50 MB (Tom, 2026-10-24). Only the service role reaches it, through `withSiteAccessStore()`; no code asks for a public URL of it (test), and 052's self-check re-asserts private + 20 MB. Protected files never live in Sanity: restricted pages refuse "Download a file" CTAs (B2.2).

**Migration 052** (`052_site_access_documents.sql`, not applied; harness `hardening-052.verify.mjs`, 14 tests on real Postgres): `site_access_uploads` (reservations), `site_access_storage_trash` (objects to remove), document functions (create / update / groups / archive), `begin_upload` / `finish_upload` / `fail_upload`, `document_for_delivery`, and the sweep functions. Documents are archived, never deleted.

**Upload (direct to storage; server actions are capped at 4 MB).** `beginDocumentUpload` (management grant, `members.access.manage`): validates language, size ≤ 20 MB and the client's sha256; the database reserves the upload and CHOOSES the path `<project>/<uuid>.pdf` (max 20 pending per project, 3 h reservation); storage signs a one-time upload URL for exactly that path with no overwrite (Supabase signed upload URLs live 2 h). The browser PUTs the file. `finishDocumentUpload` downloads the stored object server-side and checks: `%PDF-` at offset 0, `%%EOF` near the end, size ≤ 20 MB and equal to the declaration, sha256 equal to the declaration. Only then does the document point at it (one transaction; a replaced language's old object is queued and removed). A failed check fails the upload and queues the object. The dashboard screens that call these functions come in B2.5.

**Delivery.** Stable address on the site itself: `/{locale}/{project}/site-access/documents/{documentId}` (own domain: `/{locale}/site-access/documents/{id}`). GET/HEAD; every request — every byte range included — re-resolves the project from the address, checks the module is enabled, resolves the visitor (environment-bound), reads the document for THIS project and evaluates its groups (OR; no live group → nobody; archived → refused).
- **View:** streamed through the function from a ≤ 60 s signed storage URL fetched server-side, with single-range support (206 + Content-Range; malformed / multi-range / stale If-Range → whole file; past the end → 416, only after authorisation). Upstream answers that do not match exactly (missing object, ignored range, different size) → 503, never passed through. Headers: `application/pdf`, inline with the localized title as filename, `Content-Language`, `ETag` = sha256, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, noindex. `maxDuration = 300`.
- **Download** (`?download=1`): 303 to a signed storage URL of at most 60 s with a localized attachment name. Signed URLs are bearer links usable without a session until they expire and not revocable in that time; never embedded, cached or logged; a new one per request.
- **Refusal is uniform:** unknown id, another project's id, malformed id, archived, no live group, wrong group, no / expired / revoked / rotated / other-environment session, module off or unreadable, store failure → browser navigation: 303 to `/{locale}/{project}/site-access/sign-in?returnTo=<document>` (the members prompt; after sign-in the document address re-checks everything); anything else: 401. Identical status, headers and body for "does not exist" and "not for you".
- **Language:** the URL's language, then the site's default (route table), then nothing (= refusal). `Content-Language` says which was served.

**Clean-up.** Daily cron `/api/cron/site-access-sweep` (CRON_SECRET): pending uploads past expiry → expired + queued; queued objects removed in batches. The database hands out only paths that NO document file row points at and forgets a path only if still unreferenced, so an active document is never deleted (proven in SQL and in the TS tests, including a deliberately mis-queued active file). Sessions / attempts retention (`site_access_purge`) is not run here — a separate decision.

**Infrastructure (documentation 2026-10-24, then confirmed by a controlled probe the same day — see the B2.5 report).** Vercel's limits page states a 4.5 MB request/response body limit for Functions; its KB says streaming responses are exempt; a 2024 community report claimed streams were cut at 4.5 MB. Fluid compute: default and Hobby max duration 300 s (Pro 800 s). **Probe (non-production preview deployment of a throw-away app in `abluo-platform`, region iad1, behind Vercel SSO + a secret header; a synthetic 20 MB PDF in a temporary private bucket on the Abluo Sandbox; everything removed afterwards):** a route handler streaming the signed-URL body returned **200 with all 20,971,520 bytes, sha256 identical, in ~2 s**, from Tom's network and from the cloud; ranges at the start, middle (1 MB), end and 8 MB all returned **206 with the correct `Content-Range` and identical bytes**; Supabase passes `Range` through correctly (206, suffix ranges, 416 `bytes */size` past the end, expired link 400). Even a *buffered* 20 MB response and a 5 MB buffered range passed — the 4.5 MB limit was not observed for route-handler responses. Slow clients: full 20 MB at 160 KB/s (126 s) and 150 KB/s (137 s) completed; a 9 MB range at 24 KB/s ran **383 s — past the 300 s duration — and completed with identical bytes**. Cuts seen only from the cloud test container stopped at ~10 MB on every path including Supabase-direct (which never touches Vercel): an egress-proxy artifact, not a platform limit. **Status: streaming confirmed; the architecture stays** (view streamed through the function with ranges; download via a ≤ 60 s signed URL; no signed URL for viewing). Planning bound: treat 300 s per response as the ceiling (a 20 MB single response then needs ≈ 70 KB/s); PDF viewers fetch by range, so slow connections ask for pieces well within it. Direct uploads (B2.5) were probed the same way: a one-time signed upload URL accepts a PUT **without any API key**, refuses a second PUT to the same path (409 duplicate — no overwrite), refuses a non-PDF content type (415), refuses a bad token, stores the bytes exactly, and answers CORS preflights for any origin with `PUT` and `content-type, x-upsert` allowed.

## 11. Phases

- **Phase 1** (this ADR, B1 + B2): groups, shared passwords, multiple groups per resource, restricted pages, protected PDFs, sessions, logout/revocation, rotation, tenant dashboard, automated security tests.
- **Phase 2:** individual identities (`site_access_subjects`, tenant-scoped, **not** Supabase Auth), group memberships, invitations and magic links via Resend (`tokens.ts` hashing, single use), expiring memberships, per-person revocation. Same gate, same evaluator; `resolveVisitor` gains a second grant source through `session_grants.subject_id`.
- **Phase 3:** passkeys (WebAuthn with the **tenant domain** as relying party — impossible with Supabase's single RP), MFA, a `high` assurance tier that refuses shared-password sessions and serves files by streaming only. Nothing biometric is ever stored.

## 12. Privacy and healthcare boundary

Phase 1 stores no personal data beyond salted IP hashes and an optional coarse device label (legitimate interest; the cookie is strictly necessary). Phase 2 makes Abluo a processor of visitor identities (DPA addendum, retention, export/delete). **Patient-specific medical records are out of scope**: no storage or delivery of them without a separate security and GDPR assessment, including a DPIA where required.

## 13. Delivery

- **B1 — foundation (done 2026-10-24, not applied, not deployed):** this ADR; migration 050 + `supabase/verify/hardening-050.verify.mjs`; `src/lib/access/` (`model`, `policy`, `password`, `session-token`, `rate-limit`, `store`, `visitor`, `management`, `server`) with unit and contract tests. No route, page, schema or UI change.
- **B2.0 — foundation fixes (done 2026-10-24, rehearsed on the Abluo Sandbox, not applied to the Abluo project):** atomic rate-limit reservation with pending attempts; environment-bound sessions; the five concurrency scenarios of the B1 review as permanent tests on real parallel connections; this ADR updated. Registering `members.access.manage` as a grantable extra moved to B2.1: the grantable catalog has a TS ⇄ SQL parity test and dashboard labels, which belong with the manifest.
- **B2.1 — module manifest & permissions (done 2026-10-24, not deployed):** `members` manifest; extras in code + migration 051 (rehearsed on the Abluo Sandbox, not applied to the Abluo project); labels en/it/de; tests for registration, defaults, extras, tenant isolation, lifecycle and support mode through the real registry and resolver.
- **B2.2 — page protection (done 2026-10-24, not deployed, no migration):** `page.access` schema + Studio rules; the gate in the slug route (home route unchanged by design); metadata, sitemap, llms.txt and navigation exclusions; `RestrictedPage` + `getAccessMessages` in 7 locales; `members.access.manage` added to `SUPPORT_NEVER_WRITES`; the it/de dashboard labels of B2.1 recorded as `machine` in `interface-translation-status.json` so they appear for review on Admin → Translations. Tests: gate branches, groq-js execution of the page, sitemap, llms and nav queries, metadata, route wiring, API inventory, cache.
- **B2.3 — sign-in and sign-out (done 2026-10-24, not deployed, no migration):** the two visitor routes, the password prompt and members strip, visitor-state notices in the gate, `Cache-Control: private, no-store` globally, `site-access` reserved, route-level tests (CSRF, project resolution on own / shared / alias / unknown hosts, cookie attributes, rate limit, fail-closed paths, return paths, cross-tenant on the shared preview host, environment binding, sign-out and revocation) and the website routes added to the route-auth matrix. Live verification needs ACCESS_IP_SALT and migrations 050/051 applied (separately authorised).
- **B2.4 — protected PDF delivery (done 2026-10-24; streaming confirmed by the B2.5 probe; not deployed; migration 052 not applied):** migration 052 + harness; document management and direct-to-storage upload functions with server-side checks; the document route (view with ranges, ≤ 60 s download links, uniform refusal); the sign-in page; the daily sweep; route-level tests for cross-tenant access, sessions, credentials, malformed requests, ranges and storage failures; B2.3 follow-ups (unconfirmed sign-out wording, `site-access` page-slug refusal, four website languages flagged for review).
- **B2.5 — tenant dashboard (done 2026-10-24, not deployed; migration 053 not applied):** the Access screen (§8): groups with their passwords, documents with direct uploads, who can see each page, signed-in counts and sign out everyone; nav entry + client segment `access` (reserved); migration 053 + harness; en strings, it/de as `machine` for review. Streaming and direct-upload probes (§10) done and cleaned up. Tests: management (group-first flow, rotation counts, isolation, read grants), page visibility (home, downloads, drafts, conflicts, other projects, live groups), actions through the real permission resolver (support visit, module off, editor, unauthenticated, cross-project ids, uploads), page 404s, SSR of the screen in en/it/de.
- **B2 — CYCE launch:** module manifest + permissions; page `access` field + gate in both page routes + metadata/sitemap/llms.txt/nav/JSON-LD exclusions; unlock/logout/file routes (origin-checked POSTs, host-derived project); prompt component + `getAccessMessages(locale)` in every platform locale; dashboard screens; upload flow; purge cron; route-level cross-tenant tests and the route-auth-matrix inventory entry; `/verify` visual review.

## 14. Known limits and residual risks (kept current; B2.6 Stage 1, 2026-10-24)

**Limits**
- **PDF streaming:** plan for a **300-second ceiling** per function response. A single full 20 MB view needs about 70 KB/s. PDF viewers fetch by range, which keeps each request small, and downloads use a ≤ 60 s signed URL that does not run through the function. The probe saw a response finish at 383 s, but that is not to be relied on (§10).
- **Files:** PDF only, 20 MB per file (bucket, database and dashboard agree). The Supabase project-wide upload limit must be ≥ 20 MB.
- **Shared database:** dev, preview and production share one Supabase project.
  - Groups, passwords and documents are per project, across all environments: a password changed on dev is changed in production.
  - Sessions are per environment.
  - Testing therefore uses a dedicated test project.
- **Sessions:** last 30 days, revocable. A signed-out browser whose revocation could not be confirmed keeps a valid session server-side until it expires or someone uses "Sign out everyone" (§9).

**Residual risks**
- Shared passwords leak by nature. Rotation and "Sign out everyone" are the remedy until Phase 2 (personal accounts).
- A Supabase outage closes restricted content (deny by default).
- A document without a completed PDF is never served. In the dashboard it shows "Not available yet" with "Add the PDF" or "Remove" (§8).
- Abluo support can **never** change groups, passwords or access, even with live-edit approval. This is enforced server-side (`SUPPORT_NEVER_WRITES` plus `supportRefuses()` in `assertModuleAction`, and the actions refuse `support_mode` before the store is opened), and tests cover it.
- If `VERCEL_ENV` or `VERCEL_GIT_COMMIT_REF` is missing at runtime, sign-in fails closed ("unavailable"). It never fails open.
- Translations written by Claude still await review: the dashboard in Italian and German, and the website in Italian, German, French, Spanish, Portuguese and Dutch. These are release requirements, tracked in `claude/platform-backlog.md` → REL-ACCESS.

**Rollback:** `supabase/verify/rollback-050-053.sql` is complete and guarded (proof: `hardening-rollback-050-053.verify.mjs`). The runbook is `supabase/APPLY-site-access-050-053.md`.

## Consequences

- Any tenant can restrict any page or PDF to any combination of groups without code.
- One extra indexed database read per request to a restricted resource; public pages unaffected.
- A Supabase outage locks restricted content (accepted: deny by default).
- New env var: `ACCESS_IP_SALT` (required for password attempts). Vercel's own `VERCEL`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` decide the session environment.
- Shared passwords leak by nature; rotation and "sign out everyone" are the remedy until Phase 2.
