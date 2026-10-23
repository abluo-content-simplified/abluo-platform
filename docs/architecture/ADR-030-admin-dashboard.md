# ADR-030 — Admin dashboard on the shared Abluo App layer

**Status:** Accepted (2026-10-08, Tom) · **Builds on:** ADR-015 R6 (admin surface gate), ADR-025 D7 (Abluo App design system), ADR-029 (tenant dashboard, account menu)

## 1. Decision

The Abluo admin (admin.abluo.app, route group `src/app/[locale]/(admin)/`) is rebuilt on the **same design system as the client dashboard**. One Abluo App, two surfaces:

- **Shared:** tokens (`.abluo-app` in `globals.css`), primitives (`PageShell`, `PageHeader`, `EmptyState`, sheets, lists, filters …) and the shell (sidebar frame, account menu, theme/text-size switches, version, sign-out, the `.abluo-app` root).
- **Per surface:** screens and compositions. The client keeps its nav registry, project switcher, phone tab bar with the "+" and its pages; the admin has its own nav and pages.

The tenant side may change independently: a client screen or composition changes without touching the admin. A **primitive or token change reaches both** — that is the point of sharing them. When the two surfaces genuinely need different behaviour from a shared component, add a **variant** (a prop, or a `data-surface` CSS hook — `AppRoot` sets `manage` / `admin`); when they diverge for good, **fork** it into the surface that needs the difference. Never make a shared component branch on which surface it is in.

## 2. Folder layout

```
src/components/app/            the shared Abluo App layer
  AppRoot.tsx                   server: .abluo-app root — Inter, theme + text-size cookies, data-surface
  shell/                        AppSidebar (frame), AccountMenu, AppIcon, AppThemeSwitch,
                                AppTextSizeSwitch, AppVersion, SignOutButton
  ui/                           primitives (moved from components/client/ui), incl. list/
  __tests__/boundary.test.ts    the boundary guard (§3)
src/components/client/          client compositions + screens (ClientSidebar = AppSidebar + switcher + tab bar)
src/components/admin/           admin compositions (AdminSidebar = AppSidebar + admin nav)
```

One path per component — no re-export shims at old paths.

`SiteStatus` stayed with the client (`components/client/home/`): its copy speaks to the site owner ("View your site", "we'll let you know").

**Copy.** Shared components read the top-level `app` namespace (shell, account menu, theme, text size, version, roles, filter bar, list/date/stat/attention primitives); admin copy lives in `admin`; client copy stays in `clientDashboard`. Role labels have one source, `app.roles` (site roles plus the platform role `abluo_admin` → "Super admin"), used by the account menu, People and the Account page. All three namespaces are checked for en/it/de parity (T4).

## 3. Boundary test

`src/components/app/__tests__/boundary.test.ts` fails when any file under `src/components/app` imports `@/app/…`, `@/components/client`, `@/components/admin`, `@/lib/modules/client-navigation`, climbs out of the folder with a relative path, or calls `useTranslations` / `getTranslations` on `clientDashboard…`. The existing guards (no raw colours T2, rem text scale, no configuration imports, PageShell on every page) now cover the shared layer and the admin too.

## 4. Admin shell and navigation

`(admin)/layout.tsx` keeps its `resolveAdminAccess` gate unchanged (login / unauthorized / mfa), then renders `AppRoot surface="admin"` + `AdminSidebar` + a main area like the client's (`md:ml-56`, padded). The signed-in admin is read as themselves with `getViewerAccount` (no service role); the account menu shows name, email, avatar and the role line "Super admin". Profile is hidden (no admin profile page yet); Help shows only when `ABLUO_HELP_URL` is set.

Nav, in order:

| Item | Route | State |
|---|---|---|
| Home | `/dashboard` | cross-project summary: tiles, analytics summary, needs attention |
| Projects | `/projects` (+ `/projects/[slug]`, `/projects/new`) | searchable list; project page = what the client sees + admin facts + analytics; **New project** wizard (client → project → design system → Owner → create; `docs/engineering/new-project-wizard.md`) |
| Users | `/users` (+ `/users/[key]`) | everyone with access across Abluo, Active now, read-only person page — amendment A1 |
| Analytics | `/analytics` (+ `/analytics/[slug]`) | portfolio table, one row per site; per-site client view + Refresh now |
| Media | `/media` | cross-project media library — the client Media screens with an admin scope (done 2026-10-08) |
| Backlog | `/backlog` | internal backlog (migration 034) |
| What's new | `/whats-new` | product updates for clients (migration 035); clients read them in their sidebar / account menu |

The empty `clients`, `content` and `settings` placeholders are deleted. Their segments stay **gated** (`RETIRED_ADMIN_SEGMENTS`) and an admin who passes the gate is redirected to `/dashboard`, so old links still land. `ADMIN_SURFACE_SEGMENTS` lists exactly the `(admin)` folders — `src/lib/proxy/__tests__/admin-surface.test.ts` reads the directory and fails on drift in either direction.

Note: admin segments are matched as the first path segment on every host, so each one is also a reserved word for a project slug or a customer-domain page slug.

## 5. Steps (all built 2026-10-08, on dev after the v1.0.48 release; migrations 033–036 NOT APPLIED)

1. **Projects / Home / Project page** — Projects as an App list (search, status filter), a per-project page (status, domains, modules, people, links to Studio and preview), Home as the cross-project summary.
2. **Analytics** — a cross-project Analytics page plus a Home summary, fed by stored snapshots (not live API calls per page view).
3. **Admin audit log** — an internal log of every admin view of a client's data (who, which project, what, when). Admin-only; never shown to tenants. Views are de-duplicated — one `*.view` row per admin + action + project per 10 minutes, checked before the insert — and paging, searching or tag-filtering a list is not a new view; changes (`media.asset.*`) are always recorded (`src/lib/admin/audit.ts`, amended 2026-10-08).
4. **Cross-project Media** — an `admin` scope in media-api (all projects, filterable by project); admin-only actions guarded by `requireAbluoAdmin`. Replaces the legacy media page.
5. **Backlog** — platform ideas, requests and fixes.
6. **What's new** — updates Abluo publishes for clients, shown in the client dashboard.

## 6. Reserved migrations

| # | For |
|---|---|
| 033 | admin audit log |
| 034 | backlog |
| 035 | what's new |
| 036 | analytics snapshots |
| 037 | project provisioning runs — the "New project" wizard (`docs/engineering/new-project-wizard.md`), NOT APPLIED |
| 049 | Users: `profiles.last_seen_at` + `touch_last_seen()`, `access_audit_log` — amendment A1 |

## Amendment A1 — Users (Tom, 2026-10-23)

**Why.** The admin had no single view of who can get into which site. Tom wants one page listing everyone, who is using a dashboard right now, and what they did — kept small ("a couple of tenants", no big control panel).

**Decisions.**

1. **Users page** (`/users`, nav: Platform, after Projects). A *Records* screen (ListToolbar + DataTable / ListRow, no cards): Person · Access · Status · 2-step · Last active; search; filters Site, Role, Status. Above it: who is **Active now**, and four tiles (Active now, People with access, Pending invitations, Without 2-step verification). One row per person across Abluo — a person can hold different roles on different sites (ADR-028); Super Admin is the platform role, shown as a badge, never as a membership. Status: Active / Invited / Archived / No access (there is no "Suspended": access ends per site by Archive, ADR-028).
2. **A snapshot, not live.** The page is read when it opens and shows "Updated 14:32" with an **Update** button that reads it again. No realtime connection, no polling on the admin side.
3. **Last seen = a heartbeat.** Supabase only knows the last *sign-in* (sessions last weeks), which cannot say who is using Abluo now. While a dashboard tab is visible (client or admin), it calls `touch_last_seen()` every 2 minutes; the database writes `profiles.last_seen_at` for the caller's own row at most once per 2 minutes. **Active now** = seen within the last 5 minutes (`src/lib/presence/model.ts`). "Last active" = the later of last seen and last sign-in, so the page works before migration 049.
4. **Access history.** Changing someone's role/extras, archiving and restoring were not recorded anywhere. They are now written to `access_audit_log` (who, whose access, which site, roles/extras before/after, `support: true` in support mode) by `src/lib/people/service.ts`. Invitations are not copied: `invitations` already records created / accepted / cancelled with their actors and is read from there.
5. **User page** (`/users/[key]`, key = user id, or `invite:<email>` for someone without an account): Profile · Access · Security · Activity, **read-only**. Activity merges, newest first (max 50): publishing actions (`content_audit_log`), access changes about them and made by them (`access_audit_log`), invitations. Every view of the list and of a person is written to `admin_audit_log` (`users.view`, `user.view` with the user id, never the email).
6. **Privacy.** Logs hold ids, roles and actions — never emails in `detail`, tokens, passwords or content. `access_audit_log` and `last_seen_at` are service-role / own-row only.

**Out of scope for A1 (in the admin Backlog):** actions from the Users page (resend/cancel invitation, change role, archive/restore, sign out everywhere), Block sign-in (account-wide), failed sign-in attempts, a platform-wide Audit Log page, how long history is kept (retention), System Health, health columns on Projects. Each gets its own amendment when picked up.

