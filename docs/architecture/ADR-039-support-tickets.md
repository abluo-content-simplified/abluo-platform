# ADR-039 — Support Tickets V1

**Status:** Accepted (2026-10-22 — scope and all open questions settled with Tom the same day)
**Date:** 2026-10-22
**Owner:** Tom
**Relates:** ADR-019 (notification outbox), ADR-028 (roles & permissions; §8 support mode, migration 038), ADR-030 (shared Abluo App layer), ADR-035 (media processing), Component Lab rules (CLAUDE.md), 2026-08-14 rule (code before migration)

---

## Context

Both dashboards already have a Support page, and both are "coming soon" placeholders that read and write nothing:

- client: `src/app/[locale]/(client)/[tenant]/support/page.tsx` (`clientDashboard.supportPage`)
- admin: `src/app/[locale]/(admin)/support/page.tsx` (`admin.supportTickets`)

The goal: **a client can report a problem in under a minute, and the Abluo admin can understand it, answer it and resolve it from one place.** V1 is deliberately small, but the data model must take later additions (attachments in replies, assignment, SLAs, AI triage) without a rebuild.

Name clash to avoid: `src/lib/support/` is **support mode** (ADR-028 §8, "View as client"). Tickets live in `src/lib/support-tickets/`.

Tickets are a **platform feature, not a module**: every project has them, they are never gated by `moduleInstallations`.

## Decisions

### D1 — One central service, strict project isolation, two views

One set of tables for all tickets. Every ticket belongs to exactly one project (`project_id`). Clients see their project's tickets (D3); the Abluo admin sees all of them. No per-tenant support system.

### D2 — What a ticket is

The client enters only **title**, **description** and up to **3 screenshots** (optional). Everything else is recorded automatically:

| Recorded | How |
|---|---|
| Ticket number `ABL-000124` | Global sequence `support_ticket_number_seq`, displayed `ABL-` + 6 digits. Separate from the internal `id` (uuid). Never derived from a timestamp. Immutable. |
| Created / updated / last activity | Database defaults + trigger. Never sent by the client. |
| Project | From the URL's project, checked against the person's grant. |
| Person | `created_by` = the signed-in user; name, email and role shown to the admin. |
| Status | `open` on creation. |
| Context (admin-only) | Page the person came from (D9), platform version, browser, screen size, interface language, their role at the time. |

The description is stored as the **first message** of the conversation, so the thread is one uniform list.

### D3 — Who sees what (Tom, 2026-10-22)

| Who | Sees | Can |
|---|---|---|
| Owner, Project Admin | **All** tickets of the project | Create, reply |
| Editor | **Only tickets they created** | Create, reply on their own |
| Viewer | Nothing | — (the New Request button is disabled and says why) |
| Abluo admin (Super Admin) | All tickets, all projects | Everything below |

Implemented as platform permissions in `src/lib/authz/permissions.ts` (code never checks role names):

- `support.tickets.write` — create tickets and reply on tickets you can see. Project defaults: owner, admin, editor.
- `support.tickets.read` — see **all** of the project's tickets. Project defaults: owner, admin. Grantable as an extra (an Owner may give it to an Editor). Without it, a person sees only tickets with `created_by = them`.
- `support.tickets.manage` — platform only, Super Admin: list all, change status/severity, internal notes, redact.

Every read, reply, attachment link and status change re-checks these on the server.

### D4 — Statuses: four, admin-controlled

`open` · `in_progress` · `waiting_for_user` · `resolved`

- Only the admin changes status, to any of the four, including reopening a resolved ticket.
- **System transitions** (recorded as events with no human actor):
  - client replies on `waiting_for_user` → `open`
  - client replies on `resolved` **within 14 days** of `resolved_at` → `open` (event `reopened_by_reply`)
  - after 14 days the reply box on a resolved ticket is replaced by "Open a new request", which pre-links the old number in the new ticket's context
  - client replies on `open` / `in_progress` → unchanged
- Every status change appears **in the conversation** as a system line the client sees ("Status changed to In progress").

The transition rules are one pure function in `src/lib/support-tickets/state.ts` with unit tests for every row above.

### D5 — Severity: three, internal only

`low` · `normal` (default) · `high`. Super Admin only. Never sent to the client's dashboard, never in an email. Changes are recorded as internal events. No "critical" level in V1.

### D6 — Conversation

Messages have author, author kind (`client` / `support`), body (plain text, max 10,000 chars), timestamp, ticket. Chronological. Replies are text only in V1; screenshots only on the initial request (the attachments table already carries an optional `message_id` so replies can get attachments later without a migration of shape).

Abluo replies show as **"Abluo Support"** to the client, not the admin's personal name.

### D7 — Internal notes live in their own table

`support_ticket_notes` is a separate table, **not** a flag on messages. No client code path selects from it, and its RLS has no policy for `authenticated` at all — a forgotten `WHERE` cannot leak a note. In the admin UI the composer has two explicit modes, **Reply to Client** and **Internal Note**, with a different background, a different send label ("Send to Client" / "Save Note"), and notes render in the thread with a distinct tint and an "Internal — not visible to the client" label.

### D8 — Audit history

`support_ticket_events` records: created, status changed, severity changed, reopened by reply, message redacted, attachment deleted (redaction or retention), support visit started from the ticket. Each event has `visibility` `public` (shown in the client's thread: status changes) or `internal` (everything else). Append-only.

### D9 — "Report a Problem" entry point and context capture

A **Report a Problem** item in the client dashboard's help/account menu opens the new-request form with the page the person was on (`?from=`). The server accepts `from` only if it is a dashboard path of the same project (otherwise it is dropped — never echoed). The Support page's own New Request button works too, without a page.

Context (D2) is shown to the admin in a side panel, never to the client.

### D10 — Screenshots: private, validated, expiring

- Private Supabase Storage bucket `support-attachments` (the only existing bucket, `product-updates`, is public — not reused). Path `{project_id}/{ticket_id}/{uuid}.{ext}`.
- Uploaded through a server action only. PNG, JPG, WebP; max 5 MB each, max 3 per ticket. Type checked from the file's bytes, not its name.
- Metadata (EXIF, GPS) stripped on the server before storing (re-encode; use the ADR-035 pipeline if it fits, otherwise a small dedicated step).
- Viewed through signed links valid 5 minutes, issued only after the D3 check.
- **Not** Media Library assets — the "media first" rule does not apply to support screenshots (Tom, 2026-10-22).

### D11 — Retention and deletion (Tom, 2026-10-22)

- Screenshots are deleted **90 days after the ticket is resolved**. `expires_at` is set when it is resolved and cleared if it is reopened. A daily cron deletes the file and keeps a tombstone row (`deleted_reason = 'retention'`).
- Ticket text is kept for the life of the project and deleted with the project.
- **Redaction:** the admin can delete a screenshot or remove a message's text at any time (e.g. patient data uploaded despite the notice). Removal is real — the original is not kept — and the event is logged. The message shows "Removed by Abluo Support".

### D12 — Sensitive data notice

The new-request form carries a short notice (localized): don't include patient information or other sensitive personal data in text or screenshots. D11's redaction is what makes the notice enforceable.

### D13 — Notifications (ADR-019 mechanics) and unread badges

Email events, delivered with the ADR-019 pattern (outbox row → webhook + daily recovery sweep, claim/finalize idempotency, **production only**):

| Event | To |
|---|---|
| `ticket.created` | Abluo admins |
| `ticket.client_replied` | Abluo admins |
| `ticket.support_replied` | the ticket's creator |
| `ticket.resolved` | the ticket's creator |

- Tickets get their own outbox table, `support_ticket_outbox`, rather than overloading `form_events`; the consumer's claim/finalize helpers are shared, not copied.
- Emails contain the ticket number, project name and a link — **no title, description or screenshots** (a title can contain a patient's name too).
- Written in the recipient's interface language (en/it/de), no-reply sender, as for invitations.
- Internal notes and severity changes never send email.

**Unread badges in V1 as well**, in both dashboards' side nav and on each list row: per person `last_read_at` vs the ticket's last activity visible to them. On dev and preview (no email) this is the only signal.

### D14 — Abuse and double submissions

- Each New Request form carries a submit token; `(created_by, submit_token)` is unique, so a double tap creates one ticket.
- Rate limits reuse the Forms limiter: 5 new tickets per person per hour, 30 replies per person per hour.

### D15 — Not while in support mode

When the admin is viewing a client dashboard in support mode (038), the client Support pages are read-only: create and reply are refused on the server (`readSupportCookie()` is already there — a few lines). Prevents tickets written under a client's name.

### D16 — "View as Client" from a ticket

The admin ticket page has a **View as Client** button that starts a support visit (ADR-028 §8, existing `startSupportVisit`) on the ticket's project and logs an internal `support_visit_started` event on the ticket. Needs 038 applied; without it the button reports support mode unavailable, as it does today.

## Data model (migration 046, or the next free number)

```
support_ticket_number_seq
support_tickets          id uuid pk · number bigint unique default nextval · project_id fk
                         · created_by fk · title text (1–120) · status check(4) default 'open'
                         · severity check(3) default 'normal' · context jsonb
                         · submit_token uuid · unique(created_by, submit_token)
                         · created_at · updated_at · last_activity_at · last_public_activity_at
                         · resolved_at
support_ticket_messages  id · ticket_id fk · author_id · author_kind check('client','support')
                         · body text · created_at · redacted_at · redacted_by
support_ticket_notes     id · ticket_id fk · author_id · body · created_at
support_ticket_attachments id · ticket_id fk · message_id fk null · storage_path · mime
                         · bytes · width · height · uploaded_by · created_at
                         · expires_at · deleted_at · deleted_reason check('retention','redacted','project_deleted')
support_ticket_events    id · ticket_id fk · actor_id null · kind · from_value · to_value
                         · visibility check('public','internal') · created_at
support_ticket_reads     (ticket_id, user_id) pk · last_read_at
support_ticket_outbox    ADR-019 shape: event_id · ticket_id · event_type · status · attempts
                         · environment · created_at
storage bucket           support-attachments (private, 5 MB, png/jpeg/webp)
```

RLS enabled on every table, deny-all for `anon`/`authenticated`; all access through server code with the D3 checks (the 038 pattern). `ON DELETE CASCADE` from projects; project deletion also removes the bucket folder.

Code before migration (2026-08-14 rule): the pages treat a missing table as "not available yet" and keep showing today's coming-soon content. The placeholders are removed only once the migration is applied and verified.

## UI

Built only from shared components (Component Lab). Existing: PageShell, PageHeader, EmptyState, ListToolbar, DataTable, ListRow, Pill, PillSelect. New shared components (registry entry + demo first): **MessageThread** (messages + system lines + note tint), **MessageComposer** (with the D7 mode switch), **AttachmentDrop** (unless an existing upload component fits — check the registry at build time).

- **Client — Support page:** Records list (ListToolbar + DataTable on desktop, ListRow on phone, no cards) of their tickets: number, title, status, last update, unread dot. **New Request** button.
- **Client — New Request:** title, description, screenshots, sensitive-data notice, send. Phone-first.
- **Client — Ticket:** number, title, status pill, thread, reply box (or "Open a new request" per D4).
- **Admin — Support Tickets:** Records list across projects, filters project / status / severity, default "not resolved", sorted by last activity. Unread badge in nav.
- **Admin — Ticket:** thread with notes, composer (Reply / Note), side panel: status, severity, project, requester, context, screenshots (with delete), View as Client.

All text in `messages/*.json` (en source, it/de by `i18n-translate`). English navigation labels in Title Case.

## Build plan

| Slice | Contents | Depends on |
|---|---|---|
| **S1 — Data & rules** | Migration + bucket; permissions in `authz/permissions.ts`; `src/lib/support-tickets/` service (create, reply, change status/severity, notes, redact, list/read with D3 scoping, outbox writes); `state.ts` transitions; tests for transitions, scoping (editor sees only own, notes never reach client queries), idempotency, rate limits | — |
| **S2 — Client screens** | Support list, New Request (with uploads), Ticket view + reply, Report a Problem entry, support-mode read-only | S1 |
| **S3 — Admin screens** | List + filters, Ticket view, notes, status/severity, redaction, View as Client | S1 |
| **S4 — Notifications & housekeeping** | Outbox consumer + four email templates (en/it/de), unread badges, daily cron for screenshot retention, `vercel.json` cron entry | S1 |

S2, S3 and S4 run in parallel once S1 is in. New shared components (MessageThread, MessageComposer) are built in S2 and reused by S3 — S3 starts with the list screen while they land.

Release: one release when S1–S4 are on dev and verified (`docs/engineering/client-dashboard/verification.md` for the client screens), then the migration SQL is applied, then the coming-soon content is removed.

## Out of scope for V1

Voice notes, AI replies, automatic severity, assignment / multiple agents, SLAs, satisfaction surveys, reporting, categories, attachments in replies, CC'ing other project members on email, client-side status changes.
