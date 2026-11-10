# ADR-050 — Messages, Announcements and the Notification Center

**Status:** Accepted (2026-11-10 — Tom approved the ADR and its three proposals the same day; build all three slices)
**Date:** 2026-11-10
**Owner:** Tom
**Relates:** ADR-019 (notification outbox), ADR-028 (roles & permissions; §8 support mode), ADR-030 (shared Abluo App layer, What's New, migration 035), ADR-039 (Support Tickets, migrations 046–048), ADR-042 (dashboard navigation), ADR-047 (dashboard search — no desktop top bar), migration 045 (announcements), migration 049 (`profiles.last_seen_at`), Component Lab rules (CLAUDE.md), 2026-08-14 rule (code before migration)

---

## Context

Abluo talks to its clients through email and WhatsApp. Tom wants that inside the dashboard: send a person a message with a screenshot and instructions, get their reply, announce things to everyone or to a few, and have one place — a bell — that says "something needs you".

What exists today (assessment, 2026-11-10):

| Concept | Today | Gap |
|---|---|---|
| Support | Support Tickets V1 (ADR-039): threads, screenshots in a private bucket, internal notes, events, per-side read marks, redaction, outbox emails, side-nav badges | None for this ADR. Stays as it is. |
| Announcements | `product_notices` (045): dashboard banner with a time window, `info` dismissible / `warning` stays, en/it/de, audience by module | No targeting by project or person, no "acknowledge", 400-character message only |
| What's New | `product_updates` (035/045): per-person read marks, module audience, optional one-time popup | None. Stays separate. |
| Personal messages | Nothing | Everything — but the ticket thread UI, attachment pipeline, read marks, redaction and outbox are reusable |
| Notifications / bell | Each feature counts its own unread items (ticket reads, update reads, open contact requests, billing attention) | No central feed, no bell |
| Email fallback | Resend + ADR-019 outbox, claim/finalize, production only; `last_seen_at` (049) | No "you haven't been in for a while" logic |

## Core principle

**Messages are always two-way. Announcements are one-way. Notifications are contextual. The bell connects them without mixing them.** Messages, Support, What's New and Notifications stay four separate experiences.

This is a **platform feature, not a module**: every project has it; it is never gated by `moduleInstallations`. It is **not a general-purpose chat**: no client-to-client messaging, no typing indicators, no presence, no reactions.

## Decisions

### D1 — Who starts a conversation (Tom, 2026-11-10)

Only Abluo starts a conversation. Clients **reply**; they never start one. A client with a problem uses Support. This keeps Messages and Support from overlapping.

**"Abluo" is a team, not a person (Tom, 2026-11-10: "later it could be Anna from Abluo too").** Nothing in the design assumes a single Abluo admin:

- The Abluo side is a **shared team inbox**: every person holding `messages.manage` (today: Super Admins) sees every conversation. A conversation is never owned by the admin who started it.
- Every Abluo message stores **its own author**, so "Tom · Abluo" and later "Anna · Abluo" appear with no change.
- Abluo-side read marks are **per admin** (a participant row with side `abluo`, created when an admin opens the conversation), so each admin has their own unread state. The client's "Seen" means *seen by someone at Abluo*.
- Notifications and emails "to Abluo" resolve **at send time** to everyone holding `messages.manage` — never a hard-coded person.
- Room left for later, without changing the data's shape: an `assigned_to` column on conversations, and a narrower platform role (e.g. "Abluo Support") that holds `messages.manage` / `support.tickets.manage` without being a Super Admin — permissions are checked by id (`src/lib/authz/permissions.ts`), so a new role is configuration, not a rebuild.

### D2 — Messages are personal (Tom, 2026-11-10)

A conversation is visible **only to its participants and to Abluo admins**. A project role never grants access: an Owner does **not** see a message sent to their Editor. Enforced by RLS on the participants table — no `support.tickets.read`-style project permission exists for messages.

Every conversation belongs to **exactly one project** (`project_id`), and every client participant must be a member of that project when added. A person in two projects receives two separate conversations; nothing crosses projects.

Any project member can receive a message, Viewers included (it is personal, not an editing right), and every recipient can always reply.

### D3 — Several recipients: separate conversations by default, a shared thread only as a deliberate choice

Tom's concern (2026-11-10): a shared thread is useful, but dangerous if forgotten — people would start talking in front of each other without realising it.

- **Default: "Separate conversations".** Sending one message to several people creates one private 1:1 conversation per person. Each person's replies are seen only by them and Abluo. This is the default every time the composer opens; it is never remembered from the last send.
- **Option: "One shared conversation"** — allowed only when **all recipients are in the same project**. Choosing several projects makes the option unavailable, and it says why (Abluo rule: disabled actions explain themselves).
- Safeguards for shared conversations:
  - The composer shows, above Send: "Everyone in this conversation will see all replies" with the recipients' names. The Send button reads "Send to everyone (3)" instead of "Send".
  - Every participant sees the participant list at the top of the thread, and the reply box says "Your reply is visible to: Claudia, Marco and Abluo".
  - The mode is fixed once sent. People cannot be added later in V1 (adding someone would expose earlier history).
  - In the admin list, shared conversations carry a "Shared · 3 people" label.

### D4 — What a message is

- **Subject** (required on the first message, max 120 characters) and **body** (plain text, max 10,000 characters, links auto-linked, `https` only).
- **Attachments:** up to 5 per message (D5).
- **Dashboard links:** the admin can add up to 3 "Open in dashboard" link cards (e.g. "Open Digital Card"). The target is picked from the recipient project's dashboard destinations and validated on the server as a same-project dashboard path — the same rule as the ticket `from` (ADR-039 D9). Never a free URL.
- **Sender name (Tom, 2026-11-10):** Abluo messages show the author's first name plus Abluo ("Tom · Abluo"), because messages are personal — unlike tickets, which show "Abluo Support". With a second admin it becomes "Anna · Abluo" by itself (D1).
- **Language:** the admin writes in one language. No machine translation in V1.

### D5 — Attachments: images and PDFs, pasted or picked

- Private Supabase Storage bucket `message-attachments` (not the public `product-updates` bucket, not `support-attachments`). Path `{project_id}/{conversation_id}/{uuid}.{ext}`.
- **Images** (PNG, JPG, WebP, max 5 MB): handled exactly like ticket screenshots — type checked from the bytes, re-encoded, EXIF/GPS stripped (ADR-039 D10).
- **PDFs** (max 4 MB — one send goes through a server action, whose request limit is 4 MB; images are shrunk in the browser to fit, PDFs cannot be): type checked from the bytes (`%PDF-`), never re-encoded, served with `Content-Disposition: attachment`, so they download instead of rendering inside the dashboard.
- Uploaded through a server action only. Viewed through signed links valid 5 minutes, issued only after a participant check.
- **Paste from clipboard and drag-and-drop** on desktop; photo library, file and camera on phones (Abluo rule, 2026-11-10). Built as one shared `AttachmentUploader` component — and support tickets switch to it in the same slice, which delivers Tom's clipboard-paste wish for tickets too (rule of two).
- **Not** Media Library assets. The "media first" rule does not apply, as with support screenshots.

### D6 — Read receipts

`message_participants.last_read_at` per person. Opening a conversation marks it read.

- **Admin** sees per recipient: "Seen 14:32" or "Not seen yet". For shared conversations, each person is listed.
- **Client** sees "Seen" under their latest message once Abluo has read it.
- Times in the viewer's local time, 24-hour format.
- **Support mode (ADR-028 §8)** never shows the impersonated person's Messages and never writes read marks — same rule as tickets (ADR-039 D15).

### D7 — Retention and redaction

- Conversation text is kept for the life of the project and deleted with the project.
- **Attachments are deleted 90 days after the conversation's last activity** (a new message resets the clock). A daily cron deletes the file and keeps a tombstone ("File no longer available"). (Tom, 2026-11-10.)
- The admin can **archive** a conversation (it leaves both lists' default view). Any new message un-archives it automatically.
- **Redaction** as in tickets: the admin can remove parts of a message or an attachment. Removal is real and logged. A client can delete attachments they uploaded themselves.
- Deleting a conversation is not offered in V1: archive covers it, and it avoids losing history by mistake.

### D8 — Announcements: extend `product_notices`, don't rebuild

One-way stays one-way: no reply box, ever. Additions:

- **Audience** has three kinds: everyone, sites using a module (as in 045), or **specific sites and/or people** (`projects`, `users`). Specific targeting wins over modules. A person-aimed notice shows on every site of that person; a site-aimed one on that site. The database hides a specific notice from everybody else (RLS `product_notice_targets_me()`), so its text never reaches anyone it is not for.
- **Optional "Read more"** — a longer localized body (max 4,000 characters) opened in a side panel (phone: bottom sheet). The banner line stays at 400 characters.
- **Optional "Acknowledge"** (`requires_ack`): the banner shows an "OK, understood" button instead of the close ×. Admin sees, per notice: acknowledged by N of M people, with the lists of who did and who didn't.
- Product updates stay in What's New and are not announcements.

### D9 — Notifications: one feed table, written by the producers

A new table `notifications`, one row per **recipient** (fan-out on write). The bell reads only this table; nothing is computed on the fly.

- **Stored:** recipient, project (nullable for platform-wide), `kind`, source (`source_type` + `source_id`), `href` (validated dashboard path), `params` (small JSON: ticket number, conversation subject, count), `created_at`, `read_at`, `emailed_at`.
- **Not stored:** finished text. The row carries a `kind` + `params`; the panel renders the sentence from `messages/{locale}.json` in the viewer's interface language (multilingual-first). No message body, ticket description or screenshot ever goes in a notification.
- **Collapsing:** at most one *unread* row per recipient per source. A second reply in the same conversation updates the existing row (count +1, `created_at` refreshed) instead of adding another. Unique index on `(user_id, source_type, source_id) where read_at is null`.
- **Auto-read:** opening the source (the conversation, the ticket) marks its notification read. The bell is never something to clean up by hand. "Mark all as read" exists anyway.
- **Writes:** server-only (service role), through one helper `notify(...)`. RLS: a person reads and marks read only their own rows.

V1 producers:

| Kind | To | When |
|---|---|---|
| `message.received` | Recipient(s) | Abluo sends or replies |
| `message.replied` | Abluo admins | A client replies |
| `ticket.support_replied` | Ticket creator | Already an email event — also a bell row |
| `ticket.waiting_for_user` | Ticket creator | Same |
| `ticket.resolved` | Ticket creator | Same |
| `ticket.created`, `ticket.client_replied` | Abluo admins | Same |
| `announcement.ack_requested` | The notice's audience | A published notice with `requires_ack` |

Plain announcements (banner only) and What's New are **not** bell rows. `announcement.ack_requested` rows are written when such a notice is first published, for audiences whose people are known: everyone, or specific sites / people (a module audience gets the banner only). They have their own surfaces, and the bell should not get noisy. Later producers (publishing failed, billing alert, new booking, new contact request) plug into the same helper — each one is its own decision.

Side-nav badges stay (Messages, Support): they say *where*; the bell says *that*.

### D10 — The bell and its panel

ADR-047 settled that there is **no desktop top bar**. So:

- **Desktop:** the bell sits at the top of the side nav, beside search, with an unread count (shared `CountBadge`, existing attention colour, hidden at 0). On the collapsed rail it stays visible as an icon with the count.
- **Phone:** in the top bar, beside the search icon and the avatar.
- **Panel:** desktop opens a compact popover anchored to the bell; phone opens a bottom sheet. Newest 20 rows, unread first, each row = icon by kind, one-line sentence, project name (for people in several projects), time, link. Footer: "Mark all as read".
- **No interruptions:** no toasts, no sounds, no pop-ups. The count updates on page navigation and on a gentle visible-tab poll (the existing `use-visible-interval` pattern), not via realtime sockets in V1.
- The **admin dashboard** gets the same bell (shared component, ADR-030).

### D11 — Email fallback: one gentle digest

- A sweep (production only) looks for unread rows of kinds `message.*` older than **30 minutes** whose recipient has **not been in the dashboard since the row was created** (`profiles.last_seen_at`, migration 049).
- It sends **one** email per person: "You have 2 unread messages in Abluo" + a link. No subject lines, no text, no screenshots (same privacy rule as ticket emails, ADR-039 D13). At most one digest per person every **4 hours**; `emailed_at` marks the rows covered.
- **Ticket emails are unchanged in V1** (they already send immediately); ticket rows are excluded from the digest so nobody gets two emails. Folding tickets into the digest is a later decision.
- **Language:** the platform does not store a person's interface language today. `touch_last_seen()` also records it on the profile (`profiles.interface_locale`, en/it/de) from the NEXT_LOCALE cookie. Fallback: the project's default locale if en/it/de, else English.
- **When it runs (implementation, 2026-11-10):** Vercel Hobby allows only daily crons, so the sweep runs (a) after any dashboard request, at most every 5 minutes per server instance (`maybeSweepDigest()`, `after()`), and (b) daily as a fallback (`/api/cron/notifications-sweep`, which also runs file retention). On Vercel Pro the cron can simply be set to every 15 minutes.
- Sent rows get `emailed_at`; each digest is logged in `notification_emails` (the 4-hour throttle reads it). A new event on the same source resets `emailed_at`, so it can be included in a later digest.

### D12 — Navigation and screens

**Client dashboard**
- **Messages** in the side nav, first in the bottom block above Support, with an unread count. Shown only once the person has at least one conversation (no empty destination for people Abluo never wrote to). (Tom, 2026-11-10.) Because it is personal, it is **not** a tenant surface (`surfaces.ts`): the sidebar adds it itself; the route is gated as a project segment (`CLIENT_PROJECT_SEGMENTS`) and `messages` is a reserved slug.
- The list is a *Records* screen (ListToolbar + DataTable on desktop, ListRow on phones — no cards). Rows: subject, last message preview (first line), time, unread dot. Archived via filter.
- The thread reuses `MessageThread`, `ScreenshotGrid` and `ImageViewer` from tickets, with a PDF file chip and the link cards (D4).

**Admin dashboard**
- **Messages** destination: list of all conversations (Records), filter by project / person / unread / archived / shared.
- **New Message** (top-right page action): pick project(s) → pick people (person picker, grouped by project, role shown) → mode (D3) → subject, body, attachments, dashboard links → Send.
- Thread view with per-recipient read status (D6), archive, redact.
- **Announcements** screen gains audience by project/person, Read more, Acknowledge and the acknowledgement list.

### D13 — Permissions

- `messages.manage` — platform, Super Admin only: compose, see all conversations, archive, redact.
- `announcements.manage` — platform, Super Admin only (the existing notices admin moves under it).
- Clients need no permission: participation (D2) is the only access rule, checked on the server for every read, reply, attachment link and read mark, and enforced by RLS.

### D14 — Components (Component Lab)

Reused: `MessageThread`, `ScreenshotGrid`, `ImageViewer`, `CountBadge`, `Panel` / `SidePanel`, `ListToolbar`, `DataTable`, `ListRow`, `ConfirmDialog`, `TextMarker` + `RedactPartsDialog` (redaction).
New shared components (registry entry + demo each): `AttachmentUploader` (generalised from ticket screenshots; paste, drag, camera), `FileChip` (PDF), `DashboardLinkCard`, `NotificationBell`, `NotificationPanel`, `RecipientPicker`. No new colours: everything uses the existing design-system tokens.

## Data model (migrations 069+, the next free numbers)

```
message_conversations   id, project_id, subject, mode ('individual'|'shared'),
                        created_by, created_at, last_activity_at, archived_at
message_participants    conversation_id, user_id, side ('client'|'abluo'),
                        added_at, last_read_at                PK (conversation_id, user_id)
messages                id, conversation_id, author_id, author_kind ('client'|'abluo'),
                        body (≤10000), links jsonb, created_at, redacted_at
message_attachments     id, message_id, conversation_id, path, mime
                        ('image/png'|'image/jpeg'|'image/webp'|'application/pdf'),
                        bytes, expires_at, deleted_at, deleted_reason
message_events          id, conversation_id, kind, actor_id, visibility, created_at
message_outbox          ADR-019 shape (digest delivery)

notifications           id, user_id, project_id?, kind, source_type, source_id,
                        href, params jsonb, created_at, read_at, emailed_at
                        unique (user_id, source_type, source_id) where read_at is null

product_notices         + body jsonb (Read more), + requires_ack boolean
                        audience jsonb gains projects[] and users[]
product_notice_acks     notice_id, user_id, acknowledged_at   PK (notice_id, user_id)

profiles                + interface_locale ('en'|'it'|'de'), written by touch_last_seen()
```

RLS: client roles reach messages only through `message_participants` (security-definer helper, as for tickets). `message_events` with `visibility = 'internal'` and the outbox have no `authenticated` policy at all.

Rollout follows the 2026-08-14 rule: code that tolerates the missing tables ships first, then the migration.

## Build plan

1. **Slice 1 — Messages.** Tables, RLS, service, admin compose (both modes and their safeguards), client list + thread, replies, read receipts, images + PDFs, `AttachmentUploader` with paste (also adopted by tickets), dashboard link cards, side-nav counts, archive, redaction, retention cron.
2. **Slice 2 — Notification center.** `notifications` table + `notify()`, bell + panel on both dashboards, producers for messages and tickets, `interface_locale`, email digest.
3. **Slice 3 — Announcements upgrade.** Audience by project/person, Read more, Acknowledge + acks list, bell row for acknowledgements.

After slice 1, the Claudia case works end to end: a screenshot of her Digital Card and instructions to update her LinkedIn URL, a link card "Open Digital Card", her reply in the dashboard.

## Settled questions (Tom, 2026-11-10)

1. Attachment retention — 90 days after the conversation's last activity.
2. Sender name — "Tom · Abluo" (personal; "Anna · Abluo" later, D1).
3. Messages in the side nav — only after the first conversation.

## Out of scope

Client-initiated conversations, client-to-client messaging, adding participants after sending, group chats across projects, typing indicators, presence, reactions, realtime sockets, voice notes, scheduled sends, message templates, machine translation of messages, push notifications on phones, folding ticket emails into the digest, notifications from publishing / billing / bookings / contact requests (each is its own later decision).
