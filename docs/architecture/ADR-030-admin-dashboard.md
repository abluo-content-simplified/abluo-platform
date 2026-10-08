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
| Projects | `/projects` (+ `/projects/[slug]`) | searchable list; project page = what the client sees + admin facts + analytics |
| Analytics | `/analytics` (+ `/analytics/[slug]`) | portfolio table, one row per site; per-site client view + Refresh now |
| Media | `/media` | cross-project media library — the client Media screens with an admin scope (done 2026-10-08) |
| Backlog | `/backlog` | internal backlog (migration 034) |
| What's new | `/whats-new` | product updates for clients (migration 035); clients read them in their sidebar / account menu |

The empty `clients`, `content` and `settings` placeholders are deleted. Their segments stay **gated** (`RETIRED_ADMIN_SEGMENTS`) and an admin who passes the gate is redirected to `/dashboard`, so old links still land. `ADMIN_SURFACE_SEGMENTS` lists exactly the `(admin)` folders — `src/lib/proxy/__tests__/admin-surface.test.ts` reads the directory and fails on drift in either direction.

Note: admin segments are matched as the first path segment on every host, so each one is also a reserved word for a project slug or a customer-domain page slug.

## 5. Steps (all built 2026-10-08, on dev after the v1.0.48 release; migrations 033–036 NOT APPLIED)

1. **Projects / Home / Project page** — Projects as an App list (search, status filter), a per-project page (status, domains, modules, people, links to Studio and preview), Home as the cross-project summary.
2. **Analytics** — a cross-project Analytics page plus a Home summary, fed by stored snapshots (not live API calls per page view).
3. **Admin audit log** — an internal log of every admin view of a client's data (who, which project, what, when). Admin-only; never shown to tenants.
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
