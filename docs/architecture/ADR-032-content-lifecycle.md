# ADR-032 — Content lifecycle: publish, schedule, unpublish, archive, restore, delete

**Status:** Accepted (2026-10-12, Tom). Implementation phased (§6); nothing implemented at acceptance.
**Amended:** 2026-10-13 — D9 attribution, correlation, integrity and retention ([amendment](#amendment-2026-10-13--d9-attribution-integrity-and-retention)).
**Builds on:** ADR-025 (client content editor), ADR-028 (roles & permissions, vocabulary), ADR-029 (tenant dashboard), ADR-031 (Connections — removals, tombstones, partner sync), ADR-022 (gallery module), the Publicly Routable Content pattern and the Schema Evolution Rules (CLAUDE.md), the 2026-08-14 rule (never migrate production data ahead of the reading code).
**Related, kept separate:** `forms-deletion-retention-plan` (personal-data retention and erasure — §D10).
**Depends on:** ADR-031 V1 step 5 (events API + `/api/webhooks/sanity-removals`) committed and deployed — at acceptance it is still uncommitted on `dev`, so the removals webhook cannot yet be live.

## 1. Context

Every editorial module removes content differently (audit 2026-10-12):

| | Posts | Events | Galleries | Media | Pages / news (Studio) |
|---|---|---|---|---|---|
| Scheduled publish | `publishedAt` in future | — | — | n/a | — |
| Unpublish now / later | "Take offline" = `expiresAt` (doc stays published) | only `visibility` | — | n/a | Sanity Unpublish; news `expiresAt` |
| Archive / restore | — | — | — | — | — |
| Permanent delete | incl. live posts (`blog.post.delete` + `blog.published.delete`) | draft only (dashboard) | refused while `in_use` | refused while referenced | anyone with Studio access |
| Audit | none | none | none | none | none |

Facts the design relies on:
- Website routes are `force-dynamic`, `useCdn: false`: a date condition in GROQ is evaluated on every request.
- `siteConfig.timeZone` (IANA) exists (`src/lib/time/zones.ts`).
- Permissions are module-declared (`registry.ts`); writing includes publishing; no `publish` permission exists.
- Sanity Growth plan: 90-day revision history; the latest published and draft versions are always kept. Custom roles are Enterprise-only → Studio cannot be restricted per action.
- No `not-found.tsx` exists; tenant 404s render the Next.js default.
- `admin_audit_log` (033) covers Abluo-admin actions only; client lifecycle actions are not logged.

## 2. Decisions

### D1 — Three independent concepts; no stored overloaded status
| Concept | Fields (same names on every lifecycle type) |
|---|---|
| Publication window | `publishedAt`, `expiresAt` — UTC ISO. Existing names kept; UI: "Publish on" / "Unpublish on". |
| Lifecycle | `archivedAt`, `archivedBy` — absent = active. |
| Module-specific | event `eventStatus`, `visibility`, event dates, menu availability, … — untouched, never mixed in. |

The user-facing status is **derived** (D4), never stored.

### D2 — "Unpublish" never uses Sanity's Unpublish
Abluo Unpublish = `expiresAt = now` on the document that stays published (today's post behaviour). Keeps `_id` / `publicId`, references (Sanity refuses to unpublish strongly-referenced docs), slug and history. Sanity Unpublish/Delete are used only by permanent deletion.

### D3 — One public-visibility rule for every delivery path
A GROQ fragment builder in `src/lib/lifecycle/` (pattern: `DS_FIELDS_SELECTION`):
`<publishedAt rule> && (!defined(expiresAt) || expiresAt > now()) && !defined(archivedAt)`
- `<publishedAt rule>`: `required` (posts, unchanged: `defined(publishedAt) && publishedAt <= now()`) or `optional` (types adopting later: `!defined(publishedAt) || publishedAt <= now()` → existing documents stay live with no migration).
- Applies to **every public path**: list sections, detail routes, sitemap, hreflang, `generateMetadata` / OG / structured data, featured / related / "next" blocks, dereferenced references, category pages, the partner API, any future search or feed. Authenticated preview routes are exempt.
- A test fails when a public query reads a lifecycle type without it; the test owns an inventory of delivery paths that new paths must join.
- Visibility changes on the **first request after** the scheduled time; an already-open page does not update itself.

### D4 — One status function
`deriveStatus(published, draft, now)` → `draft | scheduled | published | unpublished | archived` plus `hasChanges`, `publishOn`, `unpublishOn`. Pure, unit-tested; every list, filter and badge uses it. Archived dominates; "published with an unpublish date" is a flag, not a state.

### D5 — One lifecycle service, one permission guard
`src/lib/lifecycle/service.ts`, generalised from `post-lifecycle.ts`, configured per module by a descriptor `{ type, permissions, publishedAtRule, dependencyCheck?, connected? }`. Operations: schedule, unpublish now, archive, restore, delete permanently. Each keeps today's guarantees: `assertModuleAction` first, ownership re-read (`not_found`, no probing), revision guard → `conflict`, `assertSingleSanityProject`, opaque errors, one audit row.
All operation → permission mapping lives in one `lifecycleGuard`. Publishing a draft never takes lifecycle fields from the draft; publishing an archived item is refused.

### D6 — State transitions
| From → To | Rule |
|---|---|
| Draft → Published / Scheduled | explicit publish; optional `expiresAt` |
| Published → Unpublished | now or at a future `expiresAt` |
| Unpublished → Published / Scheduled | explicit action only |
| Scheduled / Published / Unpublished → Archived | `archivedAt = now`; schedules inert (archive dominates) |
| Archived → Unpublished (Restore) | unset `archivedAt`; `expiresAt = now` (or keep an earlier one); unset a future `publishedAt` — **always Unpublished, old schedules never reactivate** |
| Draft (never published) → Deleted | allowed directly (`<x>.delete`) |
| Draft → Archived | not allowed |
| Archived → Deleted | permanent delete: permission, explicit confirmation, dependency check |
| Scheduled / Published / Unpublished → Deleted | **refused — archive first** |

Concurrent edits are caught by revision guards. Scheduling has no job to retry; what can fail (date validation, time-zone conversion, delivery queries) is covered by tests.

### D7 — Permissions (ADR-028 vocabulary, no new verbs)
| Operation | Permission |
|---|---|
| Edit drafts, publish, schedule, unpublish, cancel schedule, archive, restore | `<m>.<x>.write` |
| View an item's Activity | `<m>.<x>.read` |
| Delete a never-published draft | `<m>.<x>.delete` |
| Delete permanently (archived only) | `<m>.<x>.delete` — Owner, Site admin |

*Amended 2026-10-13 (A7): `blog.published.delete` is kept for permanently deleting previously published posts.* No separate `publish` permission now; adding one later is a change to `lifecycleGuard` and the manifests. Enforced server-side; the UI only hides.

### D8 — Time
Store UTC. Show and enter dates in `siteConfig.timeZone` (an event venue zone keeps precedence for event dates, ADR-031). DST: a non-existent local time moves to the next valid minute; an ambiguous one takes the first occurrence; the UI shows the resolved time with its offset.

### D9 — Version history and audit
- **History = Sanity.** Guaranteed: the current published + draft of every non-deleted document (why archive beats delete). Best-effort: all revisions for 90 days. After permanent delete, recovery is possible only within that window by Abluo — the UI says so; it never claims "irreversible". No custom versioning.
- **Audit = new `content_audit_log`** (Supabase), not `admin_audit_log` (different audience, actors and retention). Columns: `id, occurred_at, project_id, content_type, content_id (publicId else _id), action, actor_kind (user|system|studio), actor_id, outcome (ok|refused|failed), detail jsonb` — non-PII only, never content. Server-only (RLS on, no grants), best-effort writer, 5-year retention, survives content deletion, `actor_id` `on delete set null`.
- *Amended 2026-10-13:* attribution, correlation, monitoring and (provisional) retention are specified in the [amendment](#amendment-2026-10-13--d9-attribution-integrity-and-retention); the 5-year figure above is provisional.
- Actions: `created, published, scheduled, schedule_changed, unpublished, archived, restored, deleted, delete_refused`. "Scheduled operation executed / failed" arrive with ADR-031 V1.1 push.
- **Per-item Activity in the dashboard (now):** read-only list — action, who, when (project time zone), newest first. Actors: person's name, "Abluo support" (support mode), "Abluo team" (Studio, via a Sanity webhook). Publication boundaries shown from dates ("Went offline · 1 Nov 2026, 11:00"). Localised. Later: filters, project-wide activity screen.

### D10 — Editorial lifecycle ≠ personal data
The lifecycle service accepts only editorial Sanity types. Form submissions, inquiries, registrations and contacts follow their own retention and erasure (`forms-deletion-retention-plan`). The Submissions status "archived" is a workflow status, not D1's archive, and never extends retention. Editorial items containing personal data can always be permanently deleted by Owner / Site admin (archive → delete); audit rows hold no personal data.

### D11 — Connected applications (ADR-031)
Only content exposed through the partner API gets external removal handling (today `event`; `connected` in the descriptor). Internal types get no tombstones.

**Incremental sync detects publication boundaries** (as built: amendment A10–A15). Window = `(cursor, now − settle]`. An item is returned when any of `_updatedAt`, `publishedAt`, `expiresAt`, `archivedAt` falls in the window; the latest of those ≤ window end is its effective change time, which orders pages and becomes the next cursor (exactly-once paging preserved). Items are returned in their state at window end:
- became public → full item;
- became unavailable (expired, archived, not yet public, unlisted, websiteOnly) → `{ id, removed: true, reason }` even if `_updatedAt` did not change; new reasons `unpublished`, `archived`;
- published and expired between two polls → one removal (a removal for an unknown id is a no-op by contract);
- schedule edits move `_updatedAt` and are returned with their new state;
- late polls lose nothing — boundaries come from stored dates.

**No duplicate or contradictory signals** (enforced by integration logic): one row per item per response, computed from final state; tombstones upserted per `(project_id, resource, public_id)`; the API checks the live document before the tombstone, so a republished item is never reported removed. Push (V1.1): one emitter for webhook and sweep, idempotency key `public_id + transition + effective time`, drops a removal if the last state sent to that Connection is already removed.

### D12 — Unavailable content: HTTP and visitor experience
Scheduled, unpublished, archived and deleted URLs return **404** and render the site's branded unavailable page inside the normal layout (navigation, footer, design system):
- "This page isn't available."
- "The page may have moved or may no longer be available. You can continue exploring the website using the links below."
- "Go to homepage", plus "Browse articles" / "Browse events" / "Browse news" when the route identifies the type and that listing exists.
- Never exposes the item or its lifecycle state; identical to "never existed".
- One `not-found.tsx` in the `[tenant]` segment; strings from the website locale dictionaries; applies to every tenant 404.
- No automatic redirect. Editors who deliberately replace content add an explicit redirect via the existing `redirectFrom`. Unavailable content leaves every public discovery channel (D3). Slugs stay reserved while a document exists, so restore + republish brings the same URL back.

### D13 — Module rules
- **Events:** event date, `eventStatus`, `visibility`, publication window and archive are independent. **Past events are never archived automatically.** `expiresAt` on events is optional and explicit.
- **Galleries:** archiving refused while used by **public** content; the editor sees where. References from drafts or archived content are kept and don't block. Permanent delete keeps today's stricter rule (any reference blocks it).
- **Media Library:** no archive; delete keeps the reference check.
- **Menu (new):** adopts the lifecycle from day one.

### D14 — Studio
Studio is an Abluo-staff surface and can't be permission-restricted on Growth, so its safeguards are guardrails: for lifecycle types `document.actions` replaces Delete with Archive and Unpublish with Abluo Unpublish, and offers Delete only on archived or never-published documents. Studio lifecycle changes reach the Activity log via a Sanity webhook. The security boundary remains Sanity membership.

## 3. Migration and compatibility
- Additive only; no document is rewritten. Absent `archivedAt` = active; absent window fields on non-post types = live; posts keep their semantics.
- Reading code ships first (dev → preview → main); Studio fields/actions after. **Nothing is archived in production until Phase 1 is on `main`** — older code ignores `archivedAt`.
- Visible changes: live posts must be archived before deletion; "Offline" becomes "Unpublished"; Archive appears; branded 404; Activity starts empty on rollout day.
- Partner API: new removal reasons are additive; if the contract's `reason` enum is closed, it is versioned per ADR-031.
- Rollback: revert code; the migration only adds a table.

## 4. Rejected alternatives
- **A single stored `status` field** — mixes publication, archive and scheduling; every module would grow its own variants.
- **Sanity Scheduled Drafts / Content Releases for scheduling** — publish whole versions, cannot express "go offline at T" on this model, live in Studio, add release documents to permissions and history.
- **Archive = Sanity Unpublish + flag** — breaks references and partner identity.
- **Extending `admin_audit_log`** — different audience, actors and retention.
- **Custom versioning** — Sanity history meets the need; archive covers long-term keeping.
- **A separate publish permission now** — no client needs it; ADR-028 defers advanced roles.

## 5. Consequences
- One place to change visibility, status and permissions for all editorial modules.
- New delivery paths must register with the predicate test.
- Phase 1 is larger than "Menu prerequisites" alone: it also carries the 404 page, Activity and the partner sync fix.

## 6. Implementation plan

**Phase 0 — gates (no code):** ADR-031 V1 step 5 committed and deployed; removals webhook registered in Sanity and verified (test delete on dev → tombstone row).

**Phase 1 — foundation (before Menu):**
1. `src/lib/lifecycle/` pure core: `deriveStatus`, public-visibility builder, time-zone conversion + validation. Tests: status matrix, DST gaps/overlaps, validation.
2. Predicate applied to every in-scope delivery path + coverage test with path inventory.
3. Branded unavailable page (D12).
4. Migration `content_audit_log` + writer + per-item Activity; Studio webhook into it.
5. Lifecycle service + `lifecycleGuard`; posts re-pointed (only change: delete after archive).
6. Partner API: removal reasons + boundary-aware sync (D11).
7. Shared dashboard pieces: status badge, filters (All / Draft / Scheduled / Published / Unpublished / Archived), Publication settings (Publish on / Unpublish on / time zone), Archive · Restore · Delete permanently pattern (delete separated, confirm with title).
Acceptance (wording amended, A9): existing publication behaviour is preserved except for the explicitly approved lifecycle changes; archive/restore keeps id, slug, references; every registered path hides unavailable content; a late-polling partner receives every removal; 404 page shows no item data and is localised.

**Phase 2 — Menu module** on the foundation.
**Phase 3 — Events and galleries adoption.**
**Phase 4 — Studio guardrails.**
**Later (optional):** revision view/restore in the dashboard; pages/news in the dashboard; V1.1 push sweep + execution audit; project-wide activity; 410 for deleted URLs; separate publish permission.

Verification follows `docs/engineering/client-dashboard/verification.md` for every dashboard change; releases follow `docs/release-workflow.md`.

---

## Amendment 2026-10-13 — D9 attribution, integrity and retention

**Status:** Accepted (Tom, 2026-10-13). Implemented in two slices: **3a** (table, writer, dashboard recording, Activity) and **3b** (Studio webhook, author lookup, reconciliation, monitoring, retention job). 3b starts only after 3a is verified.

**Principle.** Activity must be trustworthy: it never shows a wrong actor, and a record that could not be written is found and repaired, never silently lost. The client sees a simple timeline; everything below stays behind the scenes.

### A1 — Attribution is exact, never inferred
| Recorded by | `actor_kind` | Shown as |
|---|---|---|
| A dashboard action by a signed-in user | `user` + their id | their profile name ("a team member" without one; "a former team member" once the account is deleted) |
| The same, in support mode | `user` + the admin's id, `detail.support = true` | "Abluo support" — never the admin's name |
| A change made in Studio (3b), author confirmed via Sanity's History API to be a person | `studio`, Sanity user id in `detail` | "the Abluo team" |
| Anything whose author cannot be established (3b) | `system`, `detail.unattributed = true` | not shown to clients; surfaced to Abluo admins |

A person is named only when the dashboard itself recorded their authenticated action.

### A2 — Correlation through the Sanity transaction id
Every dashboard write to a lifecycle type commits with a transaction id chosen beforehand (`abluo-dash-<uuid>`; the Mutations API `transactionId`, unique per dataset — verified in Sanity's API reference). The row stores it in `sanity_transaction_id`. `(sanity_transaction_id, content_id)` is unique, so the dashboard's record and a Studio-webhook or reconciliation record of the same change can never both exist, and webhook retries (at-least-once delivery) are harmless.

Dashboard recording covers every lifecycle write of posts, events and galleries — not only the type that has an Activity screen today — so a dashboard transaction without a row is an anomaly, not an expected gap. A test fails when a dashboard write path to these types commits without the audited transaction id.

### A3 — Author lookup (3b)
The webhook does not trust a prefix alone: it reads the transaction's `author` from the History API (verified 2026-10-13: each transaction carries `author`; the dashboard's write token has its own fixed identity). Dashboard token → the dashboard row is expected; a person → Studio; unknown → retry, then `system` / unattributed.

### A4 — Monitoring and reconciliation (3b)
A daily job reads the last 26 hours of Sanity transactions for lifecycle types and finds lifecycle changes without a row — **both** missing dashboard records and missing Studio records — and repairs them (Studio: as A1; dashboard token without a row: `system`, unattributed). Every repair and every write failure is visible to Abluo admins; the writer logs failures with the tag `[content-audit] not recorded`.

### A5 — Retention (PROVISIONAL — pending privacy review)
| Rows | Purpose | Retention |
|---|---|---|
| `ok` (including support-mode actions) | the client's history of their content; "who published or removed this" | 5 years |
| `refused`, `failed`, unattributed | operations and security signals | 12 months |

`actor_id` is nulled as soon as the user account is deleted; `project_id` is nulled (never cascaded) when a project is deleted. Both periods stay provisional until the privacy notice / DPA review; the 3b job enforces whatever is then confirmed.


### A6 — Operations (slice 3b)
- **Webhook** `POST /api/webhooks/sanity-content-activity` — registered in sanity.io/manage → API → Webhooks, dataset `production`, trigger on create/update/delete, drafts off, API version `v2025-02-19`, HTTP POST, secret = `SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET`. Filter and projection are `ACTIVITY_WEBHOOK_FILTER` / `ACTIVITY_WEBHOOK_PROJECTION` in `src/lib/lifecycle/studio-activity.ts` (tests evaluate both with groq-js in delta mode). dev and production may both be registered: they share the dataset and the log is idempotent per transaction.
- **Daily job** `GET /api/cron/content-activity` (vercel.json, 05:15 UTC, `CRON_SECRET`): reconciliation of the last 26 h (settled 1 h; at most 1000 transactions per run, reported when capped), then the retention purge.
- **Monitoring**: admin Home → "Needs your attention" → "Activity needs a look" per project (late, unattributed or failed records in the last 7 days); runtime logs tagged `[content-audit]`.
- **Identity of the dashboard token**: resolved from Sanity (`/users/me`) once per process; `SANITY_DASHBOARD_ACTOR_ID` overrides it.

---

## Amendment 2026-10-13 (2) — D7 permissions and slice 4 rules

**Status:** Accepted (Tom, 2026-10-13). Implemented in slice 4 (lifecycle service + `lifecycleGuard`, posts re-pointed).

### A7 — D7 amended: `blog.published.delete` is kept
Supersedes the last paragraph of D7. Deleting content that was ever published keeps its own permission, Owner and Site admin by default:

| Operation | Permission |
|---|---|
| Edit drafts, publish, schedule, unpublish, archive, restore | `<m>.<x>.write` |
| Delete a never-published draft | `<m>.<x>.delete` (Editors included) |
| Delete permanently — archived content that was ever published | `<m>.<x>.delete` **and** the module's delete-published permission (`blog.published.delete` for posts; label "Delete posts permanently") |

`lifecycleGuard` holds the map (`src/lib/lifecycle/service.ts`); the descriptor names the three permissions per module.

### A8 — Rules enforced on the server
- **"Previously published" comes from persisted content**, never from the menu or a client-supplied status: a published version exists, or the draft carries `publishedAt` / `archivedAt` (only copies of published documents do). Such a draft needs the delete-published permission too; a draft over a published item is "Discard changes", never a delete.
- **Archive is safe on the shared dataset.** Archive sets `archivedAt`, `archivedBy` and `expiresAt = now` (an earlier `expiresAt` is kept) on the published **and** the draft version in one revision-guarded transaction, so code that predates `archivedAt` (production until Phase 1 ships) already hides archived content.
- **No route back online while archived.** Publish (now / schedule / update), back online, take offline and end-date changes refuse archived content (`archived`) until it is restored. Publishing never copies `archivedAt` / `archivedBy` from the draft.
- **Restore** unsets `archivedAt` / `archivedBy` on both versions, sets `expiresAt = now` unless an earlier one exists, removes a future `publishedAt`. Going online again is the separate, explicit "Put back online" (which publishes from now when the publish date was removed).
- **Permanent delete** requires an archived item (`archive_first` otherwise) and no other document referencing it (`in_use`); it removes both versions in one transaction.
- **Activity**: a row is written only after the content change succeeded (refusals and failures are recorded as such). If the Activity writer fails afterwards, the operation still reports success and the failure is logged with `[content-audit] not recorded` for investigation and reconciliation.

### A9 — Acceptance wording (replaces "posts behave as today except delete")
Existing publication behaviour is preserved except for the explicitly approved lifecycle changes: Archive, Restore, and the permanent-delete restrictions (archive first, delete-published permission, dependency check). The dashboard's post status also gains "Archived" and shows a post taken offline before its go-live date as "Offline" instead of "Scheduled".


---

## Amendment 2026-10-13 (3) — D11 as built (slice 5)

**Status:** Accepted (Tom, 2026-10-13). Implemented in slice 5. Refines D11; where they differ, this amendment wins.

### A10 — Contract wording
- Removal rows keep Event v1's existing shape `{ id, deleted: true, reason, updatedAt }` — **not** `removed: true` (v1 is additive-only, ADR-031 D8.6).
- New reason **`archived`**, added to the v1 enum, the OpenAPI description and the `api_tombstones` CHECK (migration 042). `unpublished` already existed.
- **Consumers must tolerate unknown removal reasons** and act on `deleted: true` alone; reasons are informational. Stated in the OpenAPI description and the partner docs.
- Full rows: `updatedAt` = the effective change time (the last edit, or a publish date that passed since — whichever is later), so a row delivered because a date passed is never older than the row it supersedes. Unchanged today for events (no lifecycle dates until Phase 3).

### A11 — Paging: fixed-window sweeps
- A **sweep** runs from the consumer's cursor to a window end `w = now − settle` **fixed when the sweep starts** and carried in every `next_cursor` of that sweep (opaque cursor field). The last page's `next_cursor` starts the next sweep at `(w, end-of-instant)`. A cursor's window end is never later than `now − settle`; older cursors without one start a new sweep.
- **Effective change time** `e` = latest of `_updatedAt`, `publishedAt`, `expiresAt`, `archivedAt` that is ≤ `w`, computed in GROQ in integer milliseconds (`math::max`, `round`) and ordered by `(e, publicId)` — the public id is the stable tie-breaker. Tombstones are ordered by `(removed_at, public_id)`, `removed_at` being the server time the removal was recorded.
- **State** is evaluated at `w` (archived → unpublished → unlisted → websiteOnly); content as stored when read.
- Paging is decided on candidates; rows are then filtered (suppressed tombstones, initial-sync removals, one row per id — the latest).

### A12 — The guarantee (replaces "exactly-once paging preserved")
**At least once, latest state wins.** Every change whose effective time is ≤ `w` is delivered in that sweep, or — when the item was edited, archived, deleted or republished during the sweep — in the next one. Items may repeat; each row is a complete state statement; consumers upsert / delete by id in arrival order; repeats and removals for unknown ids are harmless. At most one row per id per response. **Exactly-once is not promised** (it holds only for sweeps without concurrent changes).

### A13 — Tombstones and republishing
A tombstone is suppressed whenever the item's published document exists when the page is read — including a tombstone recorded *after* the republish (a late or retried webhook). The item's own row reports its current state. Proven separately: older tombstone → republish (no removal reported; a consumer polling in between sees removal then item), and republish → later deletion (the removal wins, once per response).

### A14 — Initial sync
No cursor and no `updated_since` = initial sync: **removal rows are omitted for the whole first sweep** (the consumer holds nothing; never-public items such as scheduled ones are not disclosed). With a cursor or `updated_since`, a not-yet-public item that changed is reported as `unpublished` (a no-op for a consumer that never saw it); it arrives in full when its publish date passes, with no edit.

### A15 — Migration 042 and deployment order
`supabase/migrations/042_tombstone_reason_archived.sql` widens the `api_tombstones.reason` CHECK to include `archived` (additive, re-runnable; proven by `supabase/verify/tombstone-reason-042.verify.mjs`). **Order: apply 042 to production first, then deploy slice 5** — 042 is harmless to code that never writes `archived`, and slice 5 itself derives `archived` from documents (it writes no such tombstone), so neither order breaks anything; 042 first keeps contract, code and database in agreement.

---

## Amendment 2026-10-13 (4) — slice 6, shared dashboard pieces

**Status:** Accepted (Tom, 2026-10-13). Implemented in slice 6; posts adopt the pieces now, events / galleries / Menu reuse them in Phases 2–3.

### A16 — Vocabulary (the ADR words, everywhere)
Status: **Draft · Scheduled · Published · Unpublished · Archived** (+ "Pending changes" when a draft sits next to the published version — renamed from "Unpublished changes" to avoid two meanings of "unpublished"). Dates: **Publish on** / **Unpublish on**. Actions: **Unpublish**, **Publish again**, **Set / Remove unpublish date**, **Archive**, **Restore**, **Delete** (never-published drafts), **Delete permanently** (archived). Translated in en / it / de under `app.lifecycle`. Replaces the earlier Live / Offline / Take offline / Put back online copy. Internal status value `offline` → `unpublished` (old `?status=offline` links still open the Unpublished filter).

### A17 — Filters
All · Draft · Scheduled · Published · Unpublished · Archived. **"All" leaves archived items out** (archive = put away); the Archived filter shows them. Counts follow the same rule.

### A18 — One status function in practice (D4)
Lists no longer derive status in GROQ: the client and admin dashboards read `publishedAt / expiresAt / archivedAt` and call `publishedStatus()` (`src/lib/lifecycle/status.ts`), the same function the editor, the Activity log and the partner API use.

### A19 — Publication settings and time zone (D8)
`PublicationDateField` (`src/components/app/lifecycle/`) enters dates in the **site's** time zone (`siteConfig.timeZone`; the viewer's zone only if a site has none), names the zone and its offset under the field, and explains a DST gap (moved forward) or overlap (first occurrence). Used by the editor's publish step and the list's "Set unpublish date" sheet. List dates render in the site zone too (`DisplayTimeZoneContext`), so server and browser show the same dates. The list's date-range filter still compares calendar days in the viewer's zone (unchanged; follow-up if it matters).

### A20 — The Archive · Restore · Delete pattern
`lifecycleMenu(status, permissions)` decides what every module's ⋯ menu offers (draft → Delete; scheduled / published → Unpublish · Set unpublish date · Archive; unpublished → Publish again · Set unpublish date · Archive; archived → Restore · Delete permanently). Archive is never destructive; deleting is always last, **set apart by a divider** and destructive. **"Confirm with title" = the dialog names the item** (`DeletePermanentlyDialog`) and says Abluo can recover it within 90 days; one click, no typing — archiving first is the safety step. The server still decides (lifecycleGuard).

### A21 — Lists show a change at once
Lifecycle batch results return the post's new live state and the revision they replaced; the row shows it until the refreshed list carries a newer revision (`src/lib/client/posts-overlay.ts`). Fixes the row that updated only after a reload.

---

## Amendment 2026-10-13 (5) — the Studio Publishing tab (standard for every lifecycle type)

**Status:** Accepted (Tom, 2026-10-13). Implemented for **posts** and **news**; **events** adopt it in Phase 3, the **Catalogue** (ADR-033) follows it from the start.

### A22 — One "Publishing" tab in Studio
Every field about *when and how a document is visible* lives in one Studio tab named **Publishing**, in this order, with the dashboard's words (A16):

1. **Status** — read-only line (`publishingStatus`, never stored). Describes the *published* version — what the website shows — via the same `deriveStatus` as the dashboard, with dates in the site's time zone (`siteConfig.timeZone`). It also says when edited dates are waiting for Publish.
2. **Publish on** (`publishedAt`).
3. **Unpublish on** (`expiresAt`) — optional; must be after Publish on, and the message says so with the date (that rule is what blocks Publish).
4. Type-specific visibility fields — **Featured**; for events also Visibility (listed / unlisted) and the home / live-page featuring windows.
5. **Archived** (`archivedAt`) — read-only, hidden unless set. Archiving is an action (dashboard), never a date anyone types; there is no "archive date".

Rules:
- **Field names never change** — only titles, descriptions and the tab. No data migration; dashboard, websites and partner API are unaffected.
- No "Settings" tab for these fields. Content-like choices go to **Content** (e.g. the post's call to action); old slugs (redirects) go to **SEO**.
- A type's *own* dates are not publishing dates: an event's start / end / schedule stay in an **Event** tab, so "when is the event" and "when is the page visible" are never mixed.
- Building blocks: `src/lib/sanity/fields/publishing.ts` (`PUBLISHING_GROUP`, `publishingStatusField(rule)`, `publishOnField`, `unpublishOnField`, `archivedFields`), `publishing-summary.ts` (pure, tested), `PublishingStatusInput.tsx`. Pass the type's `publishedAtRule` (`LIFECYCLE_PUBLIC_RULES`) to `publishingStatusField`.
- Test: `src/lib/sanity/fields/__tests__/publishing-tab.test.ts` — add each new lifecycle type to the "Publishing tab" block.
