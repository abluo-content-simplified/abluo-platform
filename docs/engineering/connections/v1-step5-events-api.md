# ADR-031 V1 step 5 — Events API for partners

**Status:** built 2026-10-12, on dev. Not in production until the end-to-end run (below) passes.

## What a partner gets

`GET /api/v1/events` with `Authorization: Bearer abluo_at_…` — the events the website owner shared, as **Event v1** (`src/lib/connections/api/event-contract.ts`), described in OpenAPI 3.1 at `/api/v1/openapi.json`.

- **Every request is checked from scratch**, fail closed: token live → Connection active → app approved → per-connection rate limit (120/min) → `event` shared with this Connection → the project is live (active/preview) → the Events module is installed. Then data.
- **One project only.** The Sanity project slug comes from the Connection's project row; the request cannot name a project (unknown parameters are refused). Queries go through `tenantClient()` (tenant-scope guard) and exclude drafts and release versions in GROQ.
- **Only shared fields.** `projectFields()` keeps the granted fields plus the core (`id`, `url`, `createdAt`, `updatedAt`, `timeZone`). Website-only fields (live-stream URLs, featured flags, schedule, gallery) are not even fetched. Event hosts (`performers`) only when the owner ticked them.
- **Never a Sanity `_id`** — `publicId` (UUID) only. All site languages. Canonical website URL per language.

## How a partner syncs

1. First call: no parameter (everything) or `updated_since=<ISO>`.
2. While `has_more`, call again with `cursor=<next_cursor>`.
3. Store the last `next_cursor`; send it on the next poll (every few minutes in V1; V1.1 adds push).

The stream is ordered by change time and contains live events and **removals** `{ id, deleted: true, reason }`:

| Reason | Where it comes from |
|---|---|
| `unlisted`, `websiteOnly` | The event still exists; its visibility changed. Detected inline. |
| `deleted`, `unpublished` | The event is gone from Sanity. Recorded as a tombstone by the removals webhook (below). |

Changes from the last 5 seconds wait for the next poll, so a slow write never slips behind a cursor. `ETag` / `If-None-Match` → 304 when nothing changed. Every call is metered in `api_usage`. Errors are RFC 9457 problem details.

## One-time setup — Tom

**1. Webhook secret in Vercel** (Project → Settings → Environment Variables), all environments:

- `SANITY_REMOVALS_WEBHOOK_SECRET` = a long random value (e.g. `openssl rand -base64 32` in Terminal). Never shown again; never in git.

**2. Sanity webhook** (sanity.io/manage → project `3n7t84j3` → API → Webhooks → Create):

| Field | Value |
|---|---|
| Name | `Abluo — deleted content` |
| URL | `https://dev.abluo.app/api/webhooks/sanity-removals` while testing; `https://abluo.app/api/webhooks/sanity-removals` once live |
| Dataset | `production` |
| Trigger on | **Delete** only |
| Filter | `defined(before().publicId)` — every shareable type has a `publicId`, so new types (posts, menus, dishes) are covered without touching the webhook |
| Projection | `{ "type": before()._type, "publicId": before().publicId, "projectSlug": before().projectSlug }` |
| Drafts | off · Versions: off |
| HTTP method | POST · API version `v2025-02-19` or later |
| Secret | the same value as `SANITY_REMOVALS_WEBHOOK_SECRET` |

Unpublishing an event deletes its published document, so it triggers the same webhook.

## Partner example ("fake TableRes")

`scripts/partner-example/server.mjs` — no dependencies; the full flow (Connect with PKCE, token storage, refresh rotation, the sync loop with the cursor, disconnect). It is the code to hand to the TableRes developers. It runs on `localhost`, so it can only connect a sandbox (demo) website.

## Before production — the end-to-end run (with Tom's OK)

On dev.abluo.app: register "Test partner" on Partner apps → approve → connect it to tmz.it through the real consent page → exchange the code → sync events → refresh twice → reuse the old refresh token (must disconnect) → pause / resume / disconnect from Connected apps → revoke endpoint → suspend the test app. This proves the Supabase store, the route handlers and the consent page against the real database — the parts the in-memory tests cannot.

## Tests

`src/lib/connections/__tests__/events-api.test.ts` (17): isolation (own project only, unknown parameters refused), not-shared → 403, granted fields only, personal data opt-in, pause/revoke immediate, inactive project / no Events module → nothing (not even queried), removals inline and from tombstones, exactly-once paging and cursor carry-over, settle window, bad cursors/parameters as problems, ETag 304, rate limit + metering, contract ↔ registry ↔ OpenAPI in sync, query scoped and published-only, webhook signature and tombstone recording. Mutation-checked: removing any of the scope, module, visibility, settle or field-filter checks fails a test.

## Still open

- Cross-tenant suite against a real database (D8.7, step 6) — same scenarios, gating the release.
- `fullDescription` (rich text as plain text + HTML) — additive later.
- `GET /api/v1/venues` — the `eventVenue` resource; today venues travel inside `location`.
- Location filters per Connection (V1.2).
