# Abluo Engineering System — Phase 2A Follow-up: API Route Auth Verification
**Date:** 2026-07-10
**Scope:** Verify the Phase 2A finding SB-2 / TD-1 (unauthenticated API routes). Determine production reachability, whether middleware/Vercel/dataset ACL protects them, and classify each route. Read-only. No fixes.
**Parent:** [Phase 2A audit](./phase-2a-technical-audit.md)
**Status:** Complete — reviewed; findings absorbed into [Engineering Playbook v1.0](./engineering-playbook.md)

## Verification method & limits
- Read every route file under `src/app/api/` in full.
- Confirmed middleware matcher and dataset ACL (live Sanity read-only).
- **Live HTTP probing not performed:** deployed-site fetches timed out from this session and the Vercel MCP was rate-limited. Reachability is assessed from code + config at High confidence, but is **not live-confirmed**.

## Shared facts that determine severity
1. **Middleware does not touch `/api`.** `src/proxy.ts:385` — `matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']`. No route gets a session check from middleware. **Confirmed.**
2. **No auth inside the route handlers** except `media/migrate` (see below). Confirmed by reading each file.
3. **Sanity `production` dataset ACL = `public`** (live `list_datasets`: production and staging both `public`). Consequence: **all reads are already world-readable via Sanity's own public API.** Tokenless read routes therefore expose nothing that isn't already public. **Writes still require the token** regardless of ACL.
4. **No `vercel.json` / `.vercel` in repo.** Vercel Deployment Protection is a dashboard setting and cannot be confirmed from the repo. The production app is client-facing (Supabase-gated login), so blanket Vercel protection is unlikely to be on — but this is **unverified**. If Deployment Protection *is* enabled on the admin deployment, the reachable-in-production severities below drop by one level.
5. Two mutating routes (`media`, `media/[id]`, `media/tags`) construct GROQ by string-interpolating query params (`tenant`, `project`, `search`) — a secondary GROQ-injection exposure, not the subject of this check but noted.

## Per-route classification

| Route / method | Auth present? | Token | Reachable in prod? | Real impact | Class |
|---|---|---|---|---|---|
| `media/[id]` **DELETE** | None | write | Yes (code/config) | `client.delete(id)` on an **arbitrary `_id`** — not restricted to `mediaAsset`. Unauthenticated deletion of any document in a shared multi-tenant dataset. | **Critical** |
| `media/[id]` **PATCH** | None | write | Yes | Unauthenticated modify of a document's fields (id from URL). | **Critical** |
| `media` **POST** | None | write | Yes | Unauthenticated asset upload + `mediaAsset` create; write token active. | **Critical** |
| `media/verify-token` **GET** | None | write | Yes | Returns `tokenPreview = token.substring(0,10)` + validity oracle. Secret-prefix + "is the write token valid" disclosure on prod. 10 chars is not usable to authenticate. | **Medium** |
| `sanity/tenants` **GET** (plural) | None | Supabase **service role** (bypasses RLS) | Yes | No params required — dumps **all tenants** (id, slug, display_name). RLS would normally hide this; admin client bypasses it. Operational data, no secrets. | **Medium** |
| `sanity/tenant` **GET** (single) | None | service role | Yes | Tenant row by UUID (adds status, plan, domain). Requires knowing an unguessable UUID. | **Low** |
| `sanity/projects` **GET** | None | service role | Yes | Projects for a tenant by UUID. Requires UUID. | **Low** |
| `media` **GET** (list) | None | write | Yes | Lists media metadata across tenants (tenant filter optional). Data already public via Sanity ACL; write token used needlessly. | **Low** |
| `media/tags` **GET** | None | write | Yes | Distinct tags. Public data. | **Low** |
| `sanity/document` **GET** | None | none (tokenless) | Yes | Reads any doc by id, no tenant scope — but tokenless + **public dataset ⇒ no exposure beyond Sanity's public API**. | **Low** |
| `fix-colors` **GET** | None | **tokenless** `sanityClient` | Yes | Attempts `sanityClient.mutate(...)` but the client has **no write token** and the ACL grants public **read only** → the mutation **fails (401/403)** and returns 500. Cannot actually write. Reachable stray endpoint; harmless as wired. | **Low** |
| `inquiries/[id]` **PATCH** | None | service role | Yes | Merges whitelisted step-2 fields into an existing inquiry by UUID. Needs unguessable UUID; identity fields immutable. | **Low** |
| `media/migrate` **POST** | **Yes** — `Bearer $MIGRATION_SECRET` unless localhost (`route.ts:16-19`) | write | Yes | **Guarded.** Phase 2A called this "unauthenticated bulk mutation" — that was wrong. Minor edge case: if `MIGRATION_SECRET` is unset, the compare is against `Bearer undefined`. | **False Positive** |
| `inquiries` **POST** | Honeypot+timing+rate-limit | service role | Yes | Public form endpoint **by design**; spam-protected. | **False Positive** (intended public) |
| `form-submissions` **POST** | Honeypot+timing+rate-limit | service role | Yes | Public form endpoint **by design**; spam-protected. | **False Positive** (intended public) |

## Corrections to Phase 2A
- **`media/migrate` is protected** (Bearer secret) — remove it from the unauthenticated list. *(was: "unauthenticated bulk mutation")*
- **`fix-colors` cannot mutate** — tokenless client against a read-only-public ACL; the patch fails. Downgrade from "unauthenticated mutation" to **Low**. *(was: implied working mutation)*
- **Read routes are mostly Low**, because the dataset ACL is `public` — reads add no exposure over Sanity's own public endpoint. The Phase 2A phrasing "enumerate documents" overstated this.
- **The Critical core stands and narrows** to `media` POST and `media/[id]` PATCH/DELETE — with **DELETE of an arbitrary `_id` the single most serious item** (unauthenticated deletion of any document in a shared dataset).
- **verify-token** token-prefix leak is real → **Medium**.

## Bottom line
The finding is **partly confirmed, partly overstated.** Confirmed genuine exposures: three unauthenticated **write** routes on `media`/`media/[id]` (Critical), the `verify-token` secret-prefix leak and the `sanity/tenants` full-tenant dump (Medium). The rest are Low (public-ACL reads / non-functional mutation) or False Positives (`media/migrate` is guarded; the two form POSTs are intentionally public). Reachability is High-confidence from code and the confirmed `/api` middleware bypass, but **not live-verified** — one open question remains: whether Vercel Deployment Protection is enabled on the admin deployment, which if on would reduce the reachable severities by one level.

**Compliance:** No files, Sanity, Supabase, or Vercel state modified. Sanity access was two read-only calls (a count query in Phase 2A and `list_datasets` here).
