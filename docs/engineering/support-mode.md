# Support mode — an Abluo admin views a client's dashboard

**Status:** built on a branch (2026-10-08), not released. Migration `038_support_sessions.sql` is **NOT APPLIED**.
Authority: ADR-028 §8 (+ amendment 2026-10-08), ADR-029 (client surfaces), ADR-030 (admin, audit log).

## What it does

From the admin project page (`/projects/<slug>`), **View as client** opens that project's client dashboard
exactly as the client sees it, from a chosen role perspective (**Owner** by default; Site admin or Editor).

- **View only by default.** Every write is refused on the server. A persistent amber banner at the top of
  every page says *"Support mode — viewing <site> as <role>"* with the edit-access state and **Exit**.
- **Ask to make changes.** The banner's button sends a request to the client. The client's **Owner** or
  **Site admin** of that project sees it at the top of every page of their dashboard (Home included) with
  **Allow** / **Decline**. *Allow* gives the admin edit rights in this visit for `SUPPORT_EDIT_MINUTES`
  (60, `src/lib/support/constants.ts` — the one place; the database only bounds it to 5–1440). The client
  can **End access** at any time. Decline, expiry or end → view only again; the admin may ask again.
  The banner shows *waiting* / *allowed until HH:MM* / *declined* / *ended* and refreshes itself while waiting.
- **Contact requests stay hidden** (ADR-028 §8) until the admin presses **Show contact requests** in the
  banner — a separate logged event, valid for the rest of that visit.
- **Never, even with approval:** People (`users.invite`, `users.manage`), modules (`modules.manage`),
  money (`billing.manage`). Abluo support cannot add or change who has access.
- **Everything is logged** in the admin audit log (`recordAdminAudit`, migration 033) with the project id:
  `support.visit.start`, `support.visit.exit`, `support.edit.request`, `support.edit.allowed` /
  `.declined` / `.revoked` (actor = the client, `detail.by = 'client'`), `support.edit.expired`,
  `support.contact_requests.show`, and **`support.action` for every server action / route handler run
  inside a visit** (`detail`: session, `writesAllowed`, role, the Next action id, the page it came from).
- **Attribution.** Inside a visit the context's `userId` is the **admin's** id. Anything that records an
  author (e.g. `mediaAsset.uploadedBy`, the draft-preview token's `userId`) records the admin, never a
  client user; the matching `support.action` audit row marks it as done in support mode.

## How it works — one plug-in point

```
admin project page ──form──▶ startSupportVisitAction  (requireAbluoAdmin: abluo_admin + AAL2)
                               ├─ closes this admin's other open visits
                               ├─ inserts support_sessions row (service role)
                               ├─ sets httpOnly cookie abluo_support=<visit id> (host-only, ≤ 8 h)
                               └─ audit support.visit.start → redirect /<locale>/<slug>/home

every client-dashboard request ─▶ getTenantAuthorizationContext({ purpose })   src/lib/api/tenant-context.ts
                               ├─ abluo_admin? AAL2? cookie? open visit of THIS admin? unique slug?
                               │     yes → buildSupportAuthorizationContext()   src/lib/support/context.ts
                               │     no  → the person's own memberships (unchanged)
```

`getTenantAuthorizationContext()` already served every client page, layout, server action and the invite
route handlers, so support mode needed no per-page wiring. The support context:

- holds **one** project grant (the visited project, role = the perspective) and **no** tenant grants — the
  admin's own memberships are ignored during a visit, and no other project is reachable (pages still
  re-validate the URL slug against the grants and 404 otherwise);
- carries `ctx.support` (`SupportContextInfo`: visit id, project, role, effective status, `writesAllowed`,
  `expiresAt`, `contactRequestsShown`, `purpose`).

### `purpose`: render vs mutation

`supportPermissions()` (`src/lib/support/state.ts`) decides the grant's permissions:

| purpose | who passes it | permissions in a visit |
|---|---|---|
| `render` | **only** `page.tsx` / `layout.tsx` under `(client)` | the perspective role's full set (minus hidden contact requests) — so navigation, People, Media, the editor render exactly as for the client |
| `mutation` (**default**) | server actions, route handlers, anything new | reads only (`*.read`); writes only while the client's approval is live, and never people / modules / money |

Because `mutation` is the default, a new server action that forgets to say anything is refused writes in a
view-only visit. Belt and braces: `can()` and `assertModuleAction()` re-check with `supportRefuses()`.
Two tests pin this:

- `src/lib/support/__tests__/client-actions-guard.test.ts` enumerates **every exported server action under
  `src/app/[locale]/(client)`** and fails if one does not resolve its caller through
  `getTenantAuthorizationContext()` (directly or via a local helper) — unless allow-listed with a reason
  (What's-new read receipts; the admin's own banner actions) — and fails if anything other than a page or
  layout asks for `render`.
- `src/lib/support/__tests__/actions-runtime.test.ts` runs the real contact-request actions: refused with
  no database call while view-only / waiting / expired; allowed → the write runs on the visited project only.

Known consequence of `render` = full role set: in a view-only visit, write controls are **visible and
enabled** (the page looks exactly like the client's) but every one of them is refused by the server; the
UI shows its normal error and the banner says changes are blocked. Making each control render disabled
would need a read-only flag threaded through each screen — a follow-up, not a security boundary.

### Data

- **Sanity** content goes through the existing tenant-scoped client, which only needs the grant.
- **Supabase** operational data (contact requests, analytics snapshots) goes through
  `projectDataClient(ctx, projectId)` (`src/lib/support/data-client.ts`): the person's RLS session normally;
  inside a visit the **service role, refused for any project but the visited one**, after the caller's
  permission check on the support context.

### Validation on every request

The cookie only names a visit; it grants nothing by itself. Each resolution re-checks: the user is
`abluo_admin` (fresh from `getUser()`), the session is **AAL2**, the visit row exists, belongs to **this**
admin, is open (not exited, started < 8 h ago — `SUPPORT_VISIT_MAX_MINUTES`), the project exists and its
slug is unique across tenants (same guard as every grant). A client holding a forged cookie resolves to
their own access. An `allowed` row past `expires_at` is treated as expired immediately and recorded once.

The cookie is host-only. On production the admin works on `admin.abluo.app`, so the visit lives on that
host; a client's own dashboard host and the public websites never see it.

## Database — migration 038 (not applied)

`support_sessions(id, project_id, admin_user_id, role, status, started_at, requested_at, decided_at,
decided_by, expires_at, revoked_at, revoked_by, contact_requests_shown_at, ended_at)`.

Status = the visit's edit-access state: `viewing → requested → allowed | declined`, `allowed → expired |
revoked`, any open state `→ ended` (admin exit; terminal). `viewing` and `revoked` were added to the
statuses named in the brief: a visit exists before anything is asked, and "the client ended it early" must
not be confused with "the admin left".

- RLS on; `authenticated` may only **SELECT** rows of projects they manage (`get_my_support_project_ids()`:
  tenant Owner or the project's Site admin). No insert/update/delete for API roles; the admin side writes
  with the service role behind `requireAbluoAdmin()`.
- The client's decision goes only through `support_session_decide(id, 'allow'|'decline'|'revoke', minutes)`,
  SECURITY DEFINER, empty `search_path`: re-checks management, refuses the requesting admin (a CHECK also
  forbids `decided_by = admin_user_id`, which matters because Tom's accounts own tenants), validates the
  transition and the duration.
- One open visit per (admin, project) (partial unique index).
- Proof: `supabase/verify/hardening-038.verify.mjs` (real Postgres; run `npm run verify` in `supabase/verify`).

Apply **after** the code is deployed. Until then: the admin's button reports "not available yet", the
client dashboard shows no notice, nobody's access changes.

## Files

| Path | Role |
|---|---|
| `src/lib/support/constants.ts` | duration, visit lifetime, cookie name, role perspectives |
| `src/lib/support/state.ts` | pure: row mapping, effective status, transitions, permission filter, `supportRefuses` |
| `src/lib/support/context.ts` | pure: builds the support `TenantAuthorizationContext` |
| `src/lib/support/server.ts` | I/O: cookie, visit load (+ lazy expiry), audit, admin actions, client notices + decision |
| `src/lib/support/data-client.ts` | project-scoped Supabase client for support visits |
| `src/lib/api/tenant-context.ts` | the one plug-in point (`resolveSupportContext`) |
| `src/app/[locale]/(admin)/projects/[slug]/support-actions.ts` | start a visit |
| `src/app/[locale]/(client)/[tenant]/support-actions.ts` | exit / ask / show requests (admin); allow / decline / end (client) |
| `src/components/admin/projects/ViewAsClient.tsx` | the admin page section |
| `src/components/client/support/SupportBanner.tsx`, `SupportAccessNotice.tsx` | banner (admin), notice (client) |
| `messages/{en,it,de}.json` | `clientDashboard.support.*`, `admin.projectPage.support.*` |

## Not done yet (follow-ups)

- **Emails** to the client when edit access is requested / starts / ends (ADR-028 §8) — not built; the
  in-dashboard notice is the only channel.
- **Client Activity page** listing support visits and changes (ADR-028 §8) — the data is in the admin audit
  log and `support_sessions`; no client screen yet.
- **Per-project settings** (duration choice, "may make changes without asking") — replaced for now by the
  single 60-minute constant (Tom, 2026-10-08).
- **Disabled controls** in view-only mode (see above).
- `support.action` records the Next action id, not a human name for the action; the target document id is
  not captured centrally.
- The greeting and account menu show the admin's own name/avatar during a visit.
