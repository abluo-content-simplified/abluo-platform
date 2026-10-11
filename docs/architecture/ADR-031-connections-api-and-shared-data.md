# ADR-031 — Connections: partner API, webhooks and shared data (first slice: Events ↔ TableRes)

**Status:** Accepted (2026-10-11, Tom) — revision 2, after external review.
**Builds on:** ADR-028 (roles & permissions, support mode), ADR-014 (one configuration surface), ADR-021 (consent), ADR-016/020/022 (modules), the Publicly Routable Content pattern (CLAUDE.md)
**Prerequisite met 2026-10-11:** both Sanity datasets are `private` (`docs/engineering/sanity-private-dataset.md`). No partner API is meaningful while the CMS is world-readable.

**Revision 2 changes:** precise conflict/rollback rules (D5); phased scope V1 → V1.1 → V1.2 → later (§4); API keys named as a later phase, not deferred indefinitely (D2); project-vs-location rule (D6); immutable occurrence ids (D7.6); refresh-token rotation rules (D2); cross-cutting requirements (D8).

## 1. Context

Tom is building a table-reservation system (**TableRes**) and wants a restaurant offering in Abluo. Data must flow both ways depending on where a restaurant started:

- Born in Abluo, later adds TableRes → Abluo data (identity, hours, menus, events) seeds TableRes.
- Born in TableRes, later adds Abluo → TableRes data seeds Abluo.
- Ongoing: TableRes shows the tenant's events (and later menus); Abluo shows booking.

The same mechanism must serve future third parties (booking/delivery platforms, city calendars, Google Business Profile) and must never give a partner access to the CMS, to other projects, or to anything the tenant did not approve.

Audit 2026-10-10: the authorization core is ready (`can()` fail-closed, closed permission registry incl. `events.event.read`, per-request resolution from the DB → instant revocation, module gating, server-only tables, audit log, signed webhook pattern from form-events). Missing: a non-human principal, a public versioned API, outbound webhooks, and a tenant UI to grant/revoke.

## 2. Decisions

### D1 — The Connection is the central object
A **Connection** = one partner app × one project (× optionally a subset of that project's locations, V1.2), carrying: what is shared (resources + fields), ownership per data group (V1.2), delivery (pull; push from V1.1), status (active / paused / revoked), and its audit trail. Credentials, webhook subscriptions, usage and logs all hang off the Connection. Revoking it ends everything at once.

Partners are **never** Supabase users and never hold a membership. They cannot sign in to any dashboard or to Studio.

### D2 — Credentials: OAuth 2 from V1; scoped API keys in a later phase; no human ever handles a secret
- Partner apps are **registered** with Abluo (TableRes first). Registration is reviewed and approved by an Abluo admin (D8). The app's client id/secret live only on the partner's servers.
- A tenant **Owner or Site admin** links an app with **Connect** (from Abluo, or starting from the partner's side). Flow: OAuth 2 authorization code **with PKCE**, exact registered redirect URIs, an Abluo **consent screen** naming the site, resources and fields ("TableRes wants to read the events of Da Mario: title, dates, image…"). The consent screen is localized (multilingual-first).
- Abluo returns a single-use, minutes-lived code; the partner exchanges it server-side for a **short-lived access token (~1 h)** and a **refresh token**. Tokens are scoped to that Connection.
- **Refresh-token rotation:** every refresh issues a new refresh token and retires the old one. A short **grace window** (≈30 s) lets a partner retry a refresh whose response was lost, so a network blip never disconnects anyone. **Reuse of a retired token outside the grace window revokes every token of that Connection** (theft detection) and marks the Connection "needs reconnect" in the tenant dashboard.
- Access tokens are checked against Connection status on every request — revoke/pause is immediate.
- Expanding what is shared re-shows consent (incremental authorization); nothing is widened silently.
- Stored hashed; recognisable prefixes (`abluo_at_…`, `abluo_rt_…`) for secret scanning.
- **No hand-rolled OAuth.** Use a proven OAuth 2.1 / OIDC server implementation. First check whether Supabase Auth's OAuth-server capability fits our scoping; otherwise a maintained library (e.g. `oidc-provider`). Decided in the V1 implementation plan.
- **Scoped API keys — phase "Later" (named, not indefinite):** for small partners without an app. The tenant **invites a developer**; the developer signs in to a minimal Abluo developer page (no CMS access) and **mints the key themselves**, seeing it once. Keys are read-only by default, one Connection each, with expiry, rotation, optional IP allowlist. Keys are never sent by email.

New permission (platform registry, not grantable as an extra): `connections.manage` — default Owner (tenant) and Site admin (project). Support mode (ADR-028 §8) can view Connections, never create, widen or reveal anything.

### D3 — Partners get a fixed contract, never Sanity
The API exposes versioned resources (`Event v1`, later `Location v1`, `Menu v1`) whose shape is **based on schema.org** (`Event`, `Place`/`PostalAddress`/`GeoCoordinates`, `OpeningHoursSpecification`, `Menu`/`MenuSection`/`MenuItem`, `Offer`) with Abluo extensions (all locales, stable ids, timezones, exceptions). The same shapes feed the websites' **JSON-LD** (Google rich results).
- Each contract field is classified **public** (already on the website; shareable, on by default) or **website-only** (never leaves Abluo — e.g. live-stream URLs, featured-on-live-page flags). Optional sensitive fields, if ever added, are opt-in per Connection.
- Personal data in a contract (e.g. an event host's name) is flagged as such and is opt-in (D8 privacy).
- Published content only; never drafts.
- **Ids and timestamps (verified 2026-10-11 against production):** all 524 published Sanity documents carry the system fields `_createdAt` and `_updatedAt` (0 missing) — Sanity sets them on every write, so they are guaranteed for all current and future content. `_id`s are permanent but **not uniformly UUIDs**: Studio-created documents have UUIDs (e.g. the 4 Livener events), script-imported ones have readable ids that embed tenant and content names (e.g. `cyce-event-pranayama`, `hoffmann-page-home`). Therefore **the API never exposes Sanity `_id`.** Every shareable type gets a `publicId` field (UUID, set on creation, read-only, never changed) and a one-off backfill for existing documents (additive; reading code first, per the 2026-08-14 rule). The contract's `createdAt`/`updatedAt` map to `_createdAt`/`_updatedAt`; `updatedAt` also moves on edits to website-only fields, which only causes a harmless extra sync. Deletions leave no trace in Sanity, hence tombstones (D4). New Supabase tables in this ADR all carry `created_at`/`updated_at` (trigger-maintained).
- Every resource carries its **canonical website URL** so partners link back to the tenant's site.
- Images: CDN URLs (with focal-point crops); the receiving side copies them into its own media library.
- Text: all locales the site has; rich text delivered as plain text + HTML.
- Spec published as **OpenAPI 3.1**. Errors use **RFC 9457 problem details**.

### D4 — Delivery
- **Pull (V1):** `GET /api/v1/...` — REST + JSON, `updated_since` cursor, pagination, ETags, per-Connection rate limits, every call metered (pattern: `translation_usage`) and audited. Removals are visible to pull clients through the cursor as tombstones (`deleted: true`, with the time) so a partner polling never misses a cancellation or removal.
- **Push (V1.1):** outbound webhooks following the **Standard Webhooks** spec (`webhook-id`, `webhook-timestamp`, `webhook-signature`, per-Connection signing secret fetched over the authenticated API). Retries with backoff + a sweep, modelled on `form_events` + `/api/cron/form-events-sweep`. Source: Sanity publish/unpublish/delete → fan-out to Connections sharing the resource. Events: `event.published`, `event.updated`, `event.removed` (unpublish, delete, or made website-only), per occurrence for series.
- Idempotency keys on any future write endpoint.

### D5 — Ownership: one owner per data group (V1.2)
Two systems never both edit the same data. **Not needed in V1/V1.1:** events are always owned by Abluo there, so no two-way sync exists until V1.2.

- Groups: **identity** (name, address, phone, type), **opening hours & closures**, **menus**, **events (content)**. Fixed, never a choice: reservations/tables/availability → TableRes; pages/design → Abluo.
- Ownership is set **per location** (D6). Defaults = where the tenant was born; the tenant can change any row at Connect.

**Conflict resolution at Connect (both sides already hold data):**
1. Abluo fetches the other side's values and shows a **difference view per group** (e.g. "Hours — Abluo: Mon closed · TableRes: Mon 19–23").
2. The tenant chooses an owner **per group**. **The owner's values replace the other side's values for the whole group.** There is **no field-by-field merge**, ever — results are predictable and nobody ends up with a mix of two sources.
3. **Before anything is overwritten, a snapshot** of the replaced values (and the previous ownership map) is stored (`connection_snapshots`).
4. Only then is the copy performed and the non-owner side locked.

**Rollback:** a **Restore** action for **30 days** after any overwrite puts back the snapshot values *and* the previous ownership map in one step, and is itself audited and snapshotted (so a restore can be undone). After 30 days snapshots are purged.

**Ongoing sync — conflicts are impossible by construction:**
- The non-owner side is **read-only** ("Managed in TableRes · Edit there").
- Every change carries a **monotonic version number** from the owner. The receiver applies a change only if its version is higher than what it stores; older or duplicate deliveries are ignored. Retries and out-of-order delivery are therefore harmless.

**Switching owner is a locked three-step operation:** (1) both sides lock the group; (2) the new owner receives a fresh copy from the old owner (snapshot first, as above); (3) the new owner unlocks. No edit can land in between; on failure everything unlocks back to the previous owner.

**Disconnect:** each side keeps its last copy; both become editable; snapshots remain restorable for their 30 days.

**Requirement:** any group either side may own must be modelled equally well on both sides (hours: weekly, split shifts, exceptions/holidays, IANA timezone). The contract (D3) is the spec TableRes builds to.

### D6 — Places, not tenant types; project vs location
No code asks "is this a restaurant?". Behaviour follows data.
- `siteConfig.locations[]` (existing `siteLocation`: key, name, address, mapsUrl, pin, accessNote) is the platform's **Place**. In V1 an event can reference a location key. In V1.2 locations gain: opening hours (+ exceptions), IANA timezone, phone, `placeType` (restaurant, bar, studio, office… — used only for schema.org `@type`, never for branching), and external links (e.g. TableRes restaurant id).
- An event's place is either one of the site's locations (pre-selected when there is exactly one) or a **saved venue** (name + address, reusable; Livener's case). Saved venues are per project.

**Project vs location — the rule:**
- Restaurants that have **separate websites, or separate staff who must not see each other's data** → **separate projects** under one tenant (1-to-N projects per tenant is supported).
- Restaurants that share **one website and one team** → **one project with several locations**.
- Permissions are **per project; there is no per-location permission**. Location scoping on a Connection is a **data filter, not a security boundary.** Before V1.2, verify the 1-to-N project paths end to end for a multi-restaurant tenant.

### D7 — Events changes
All **additive** fields; no existing field changes type (Schema Evolution Rules).

**V1**
1. **Visibility:** `public` (site + Connections) · `websiteOnly` · `unlisted` (link-only, noindex, never shared). Connection rule: share *all public events* or *only ticked events*.
2. **Event status:** `scheduled` · `cancelled` · `postponed` · `soldOut` (schema.org `eventStatus`). "Past" is derived from dates; the existing `status` field is retired in a later, separate step after reading code no longer depends on it.
3. **Place:** location key or saved venue (D6); the free-text `location` stays as fallback until migrated.
4. **Timezone:** from the place (or the project default).
5. **Booking mode:** none · external link (existing `registrationUrl`) · **via TableRes** (Abluo owns content, TableRes owns seats).
7. **Removals** visible to partners (tombstones in V1 pull; `event.removed` webhook in V1.1).

**V1.1**
6. **Recurrence:** an event may be a **series** with an RFC 5545 `RRULE`, stored as **local time + IANA timezone** (20:00 every Friday stays 20:00 across DST), plus exceptions (skip a date; override one date's time, guest, or status). The editor offers presets ("Every week on Friday · until …"), never raw RRULE.
   - **Occurrences are materialized** for a rolling window (12 months) as records with an **immutable, opaque id** (never derived from a date), plus `originalStart` (the iCal `RECURRENCE-ID`, for interoperability) and the actual `start`/`end`.
   - Moving one occurrence changes its `start`, never its id. Changing the rule matches existing future occurrences to the new dates where possible (keeping their ids); occurrences that no longer exist are tombstoned (`removed`), new ones get new ids. Occurrences with bookings in TableRes are never silently dropped: the editor warns before a rule change removes them.
   - Website: the event page lists upcoming dates; listings show the next date only.

These fields also satisfy Google's Event rich-result requirements.

### D8 — Cross-cutting requirements (all phases)
1. **Privacy & legal.** Partner API terms and a data-processing agreement accepted when a partner app is registered; the tenant's consent is recorded per Connection (who, when, what). Personal data (e.g. host names) is opt-in. On disconnect the partner is contractually required to delete or stop showing shared data; tombstones tell it what to remove.
2. **Partner app approval.** Only Abluo-approved apps can request Connect; the admin dashboard lists all apps and all Connections across tenants, with the ability to suspend an app globally.
3. **Sandbox.** A test mode: sandbox Connections against demo projects, so TableRes (and any partner) can be built and tested without touching real tenants.
4. **Connection health for the tenant.** The Connected apps screen shows last successful call / delivery, errors, and "needs reconnect"; the tenant (and Abluo) is notified when a Connection breaks — following the notification rules (workflow boundaries only).
5. **Lifecycle.** Uninstalling the Events module, pausing/cancelling the tenant, or archiving the project **automatically pauses** affected Connections (fail closed). A suspended partner app pauses all its Connections.
6. **Versioning policy.** `v1` is never changed incompatibly; additive fields only. A breaking change means `v2`, with a published deprecation period and `Deprecation`/`Sunset` headers on `v1`.
7. **Security verification.** A cross-tenant API test suite (a Connection can never read another project, a draft, a website-only field, or a resource it was not granted), in the same style as the `supabase/verify` harness, gating every release that touches the API.
8. **Localization.** Consent screen, Connected apps screen, emails and errors shown to tenants are localized; no hardcoded strings.

## 3. Data model (Supabase, server-only — RLS on, no grants to `anon`/`authenticated`)
- `partner_apps` — registered apps (name, owner, redirect URIs, client id, hashed client secret, status, approved_by/at, accepted terms version).
- `connections` — app × tenant × project (× location keys, V1.2), shared resources + fields, ownership map (V1.2), delivery, status, consent record, created_by, timestamps, sandbox flag.
- `connection_tokens` — hashed access/refresh tokens, expiry, rotation chain (`replaced_by`, `retired_at`), revoked_at, last_used_at.
- `oauth_codes` — single-use codes (hash, PKCE challenge, expiry).
- `api_tombstones` — removals per project/resource for pull cursors.
- `webhook_deliveries` (V1.1) — outbox: event id, connection, payload hash, attempts, status (pattern: `form_events`).
- `connection_snapshots` (V1.2) — pre-overwrite values + ownership map, 30-day retention.
- `api_usage` — per-connection metering (summed in SQL).
- Audit: entries for register/approve app, connect, consent change, ownership change, overwrite, restore, pause, revoke, token-reuse revocation.

Event occurrences (V1.1) live in Sanity beside the series (or a server-side table if Sanity proves unsuitable — decided in the V1.1 plan); their ids are opaque and immutable either way.

`can()` gains a third subject kind (`connection`) resolving only the permissions granted on that Connection's project; platform/people/billing/module permissions are structurally unreachable.

## 4. Phases and build order

**0. ✅ Done** — Sanity datasets private (2026-10-11).

**V1 — prove secure event sharing Abluo → TableRes**
1. Accept this ADR.
2. Events additive schema (D7 1–5, 7) + `publicId` on events with backfill (D3) + Event JSON-LD on event pages — useful on its own.
3. Migration: `partner_apps`, `connections`, `connection_tokens`, `oauth_codes`, `api_tombstones`, `api_usage` (+ verify harness like 028–039).
4. OAuth (proven library), consent screen, Connected apps screen (`connections.manage`), partner app approval in the admin, sandbox mode.
5. `GET /api/v1/events` (+ OpenAPI, problem details, tombstones), TableRes polling as first client.
6. Cross-tenant API test suite (D8.7) green before release.

**V1.1 — real-time and recurring**
7. Outbound webhooks (outbox + sweep, Standard Webhooks).
8. Recurring events with materialized, immutable-id occurrences (D7.6).

**V1.2 — locations, hours and ownership (two-way)**
9. Verify the 1-to-N project paths for multi-restaurant tenants (D6).
10. `Location v1`: hours + exceptions, timezone, phone, placeType, external links.
11. Ownership map, difference view, snapshots + Restore, locked owner switch, versioned one-way sync (D5).
12. Bootstrap import both directions (born in TableRes ↔ born in Abluo).

**Later**
13. Menus are **out of scope** for this ADR — the Menu module gets its own ADR. When it wants to be shared, it plugs in as a new resource (`Menu v1`) on the Connection model defined here.
14. Scoped API keys via the invited-developer page (D2).
15. Partner writes (land as drafts for tenant approval).

## 5. Consequences
- TableRes uses the public API like any partner — no back door; every future partner inherits it.
- The contract decouples partners from the Sanity schema; the schema can evolve freely behind `v1`.
- V1 contains no two-way sync; the hardest problem (D5) is isolated in V1.2 and designed now so V1 does not paint it into a corner.
- Locations become a richer, central concept in V1.2; hours live there, ownership per location.

## 6. Open questions
- Supabase Auth OAuth server vs a dedicated library (V1 plan).
- Occurrence storage: Sanity vs server table (V1.1 plan).
- Whether TableRes supports multi-location groups from V1.2 day one or single-location first.

## Amendment A — Event place: city first, exact place optional (2026-10-11, Tom)

Refines D6/D7.3 after the V1 step 2 dev review. Not yet built.

1. **City (always available, optional).** The existing free-text `location` field stays, relabelled **City** in Studio and the client dashboard (localized, e.g. "Bologna" / "Bologne"). It is the basic info and is enough for most events. JSON-LD: `Place` with `address.addressLocality`; partners: `city`.
2. **Exact place (optional).** "Add the exact place" opens an **address search with Google suggestions** (Places Autocomplete). Choosing a result fills name, structured address and pin. Choices offered first: the site's own locations and saved venues (one tap, matched as you type — no duplicate venues).
3. **One-off vs saved.** Unticked by default, **"Save this venue for next time"**:
   - unticked → the place is stored **inline on the event** (`place.kind = 'custom'`: name, address, mapsUrl, pin) — a full structured place, but not in the venue list;
   - ticked → an `eventVenue` is created (with `publicId`) and the event references it.
   A one-off place can be saved later from the same event. Editing a saved venue changes it for every event that uses it (the editor says so). Anyone with `events.event.write` may save a venue.
4. **Event page.** With an exact place: name + address, "Open in Google Maps" link, and an **embedded map** — click-to-load through `ConsentEmbed` (vendor `google-maps`, ADR-021). The site-embed detection (`siteEmbedsQuery` / `detectSiteEmbedVendors`) is extended to events with a mapped place, so the cookie banner's External content category appears on such sites. Without an exact place: the city only, no map.
5. **Precision for Google and partners.** Full address + geo when there is an exact place; otherwise the city.
6. **Keys.** The dashboard address search needs a Maps JavaScript + Places key allowed on the dashboard hosts (env var only, referrer-restricted — `docs/engineering/google-maps-keys.md` gains a third key or extends the Studio key's referrers; decided in the build plan). The website embed keeps using `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (Embed API only).
7. **Migration.** None required: `place.kind` gains the value `custom`; `location` is unchanged. Existing events keep showing their city.
