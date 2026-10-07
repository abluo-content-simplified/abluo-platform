# ADR-029 — Tenant dashboard: an operational workspace, not a configuration surface

**Status:** Proposed (2026-10-07, Tom) · **Builds on:** ADR-017 (client shell), ADR-025 (client editor + app design system), ADR-028 (roles & permissions), ADR-014 (integration registry)

## 1. Requirement (Tom, 2026-10-07)

The tenant dashboard gives a concise overview of website activity, content status, audience performance and items needing attention, and lets the customer take simple content or operational actions — without exposing platform configuration. It answers four questions:

1. What is happening on my website?
2. How is the website performing?
3. What needs my attention?
4. What should I work on next?

It is **module-aware**: a widget or nav item appears only when its module or integration is active for the project **and** the user holds the permission for it.

### The rule

> **Visibility in the tenant CMS is opt-in, not automatic.** A capability being supported by Abluo does not mean the tenant can see or configure it. Tenant-facing controls must be explicitly designed and registered for that use case.

### Never in the tenant UI (admin-only, by default)

Languages · modules / feature activation · domains · infrastructure & deployment · global integrations configuration · technical SEO · privacy / platform configuration · tenant architecture & system settings. **There is no general-purpose Settings area in the tenant UI.**

A tenant may get a *narrowly scoped feature control* when it is deliberately part of the product (e.g. LinkedIn publishing: connect / authorise / pick from permitted options / disconnect). It stays inside that feature and never exposes the underlying integration or project configuration.

### User-level preferences ≠ project configuration

Appearance, text size, sign out (today at the bottom of the sidebar) move into the signed-in user's **account menu**: Account · Appearance · Text size · Help · Sign out. They affect only that user's CMS experience.

## 2. Current state (audit, 2026-10-07)

| Area | Today | Verdict |
|---|---|---|
| `[tenant]/home` | Greeting, View your site, Continue editing, latest posts/galleries, new requests | Keep — becomes the dashboard. Two blocks are inline markup → extract |
| `[tenant]/analytics` | "Coming soon" stub | Remove now; real page in Phase 3 |
| `[tenant]/leads` | "Coming soon" stub, superseded by `submissions` | Delete |
| Sidebar footer | Theme switch, text size, Account, Sign out, version | Move into AccountMenu |
| `/account` | Project list with role label (a slice-4 verification page) | Rebuild as the real Account page |
| Nav | `MODULE_DASHBOARD_ROUTES` + `mediaNavItems` + `peopleNavItems` | Good base; generalise into the surface registry (§3.1) |
| GA4 / Search Console data | Only the GA4 *tracking* manifest (measurement ID); no reporting API, no GSC | New in Phase 3 |

**In flight elsewhere:** the roles chat (ADR-028 steps 3–5) has uncommitted changes in `ClientSidebar.tsx`, `[tenant]/layout.tsx`, `client-navigation.ts`, `client-surface.ts` and `messages/*.json`. Phase 1 starts only after that work is committed.

## 3. Architecture

### 3.1 One tenant-surface registry (the opt-in rule, enforced)

A single file, `src/lib/client/surfaces.ts`, lists **everything** a tenant can see: nav items, home widgets and feature controls. Each entry declares:

```ts
{ id, kind: 'nav' | 'widget' | 'featureControl',
  requires: { module?: string; integration?: string; permission: string },
  labelKey, ... }
```

- `buildTenantSurfaces(grant, integrations)` is pure and unit-tested; layout and home render only what it returns. Nothing is shown unless registered (opt-in by construction).
- `MODULE_DASHBOARD_ROUTES`, `mediaNavItems`, `peopleNavItems` fold into it — one surface, not three (ADR-014 "one configuration surface").
- **Boundary test** (`surfaces.test.ts`): every entry names a permission; no entry may require an admin-only permission (`modules.manage`, `settings.manage`, `tenants.manage`, `support.access`…); no `(client)` route imports Studio structure, integration config schemas or siteConfig writers.

### 3.2 Widgets are providers + shared presentation

Each module contributes a small **server data provider** (`src/lib/modules/<id>/dashboard.ts`) returning plain data through the existing enforced data layer (`assertModuleAction` → tenant-scoped client). Presentation is shared components only (§4). A module never ships its own widget look.

### 3.3 "Needs your attention" = rules from providers

Each provider may return attention items `{ id, severity, labelKey, params, href }`. First rules (all from data we already have):

- new enquiries not yet handled (forms)
- drafts untouched for 14+ days (blog, gallery)
- post scheduled within 48 h (blog)
- published post missing a language on a multilingual site (blog + translate)
- images without alt text (media)
- support asking to edit, pending your approval (ADR-028 support mode)
- invitations not yet accepted (people, Owner/Site admin only)

### 3.4 Analytics and Search Console (Phase 3)

- **Sources:** GA4 Data API and Search Console API, read server-side with one Abluo service account (env vars only, never Sanity). The tenant adds that account as a viewer on their GA4 property / GSC site; Abluo admin stores the **GA4 property ID** and **GSC site URL** in Studio (new fields on the GA4 manifest + a new `google-search-console` integration manifest with no script). Tenants never see this configuration.
- **Snapshots, not live calls:** a daily job writes per-project metrics to Supabase (`analytics_snapshots`, new migration); the dashboard reads the snapshot. Fast, quota-safe, works when Google is down, gives "vs previous period" for free.
- **Metrics (deliberately few):** visitors, page views, % change vs previous period, top pages, top acquisition channels; GSC clicks, impressions, average position, top queries. 28-day window by default; ranges via the existing `DateRangePicker` on the Analytics page only.
- **Permission:** new `analytics.read` in the ADR-028 registry.

## 4. Components — reuse first, then extract, then add

**Reused as-is:** `PageHeader`, `ListToolbar`, `DataTable` + cells, `ContentCard`, `ViewSwitch`, `BottomSheet`, `CardMenu`, `Avatar`, `Toast`, `DateRangePicker`, `Checkbox`, `ChoiceCard`, `AppThemeSwitch`, `AppTextSizeSwitch`, `AppVersion`, `ProjectSwitcher`, `Greeting`, `ContinueEditing`, `LatestList`, `anchored-popover`.

**Extracted (exists inline today, becomes a component — no duplication):**

| New component | From | Notes |
|---|---|---|
| `ui/SectionHeading` | heading + "See all" inside `LatestList` and home | `LatestList` then uses it |
| `ui/LinkCard` | "View your site" block on home | icon tile + title + subline + trailing arrow; also for Help, account rows |
| `ui/StatTile` | "New requests" block on home | value, label, optional delta (▲/▼ %), optional href |

**New (genuinely missing):**

| Component | Purpose | Later reuse |
|---|---|---|
| `ui/StatGrid` | responsive row of `StatTile`s (2-up phone, 4-up desktop) | admin dashboard |
| `ui/RankedList` | label + value + proportional bar (top pages, queries, channels) | admin, reports |
| `ui/Sparkline` | tiny inline trend for a `StatTile` (SVG, app tokens, no chart lib) | admin |
| `ui/AttentionList` | rows with severity dot + action; empty state "All caught up" | admin (cross-tenant) |
| `ui/DashboardGrid` | home layout: one column on phone, 12-track grid on desktop at the shared content width | admin |
| `ui/EmptyState` | consistent empty/“not connected yet” message | every list page |
| `AccountMenu` | avatar button → popover (desktop) / bottom sheet (phone) holding Account, Appearance, Text size, Help, Sign out, version | admin |
| `ui/SiteStatus` | live/preview status chip with "View site" | admin projects list |

All copy from `clientDashboard.*` in `en/it/de`; app tokens only (`.abluo-app`); light + dark; checkboxes square; content top-aligned; desktop and phone designed separately (ADR-025).

## 5. Home layout

**Phone (one column):** Greeting + SiteStatus → Needs your attention → Continue editing → At a glance (StatGrid) → Website traffic (2 StatTiles + sparkline, Phase 3) → Latest posts / galleries / events → Top pages (Phase 3).

**Desktop (DashboardGrid, Forms-page width):** row 1 Greeting + SiteStatus · row 2 StatGrid (4 tiles) · row 3 Needs your attention (8 cols) | Continue editing (4 cols) · row 4 Traffic + Search (Phase 3) · row 5 Latest lists side by side.

Every block is a registered widget; a project without the module simply doesn't get the block.

## 6. Delivery plan

**Phase 0 — prerequisites:** roles chat commits its sidebar/nav changes; Tom answers §7.

**Phase 1 — Boundary & shell (small, ships alone)**
1. `surfaces.ts` registry + `buildTenantSurfaces` + boundary test; layout and sidebar read it.
2. `AccountMenu`; sidebar footer and phone "More" drawer lose theme/text/sign-out.
3. Real `/account` page (name, email, appearance, text size, 2-step status, sign out).
4. Delete `leads` stub; remove `analytics` stub until Phase 3; drop dead i18n keys.

**Phase 2 — Home as a real dashboard (existing data only)**
5. Extract `SectionHeading`, `LinkCard`, `StatTile`; add `StatGrid`, `AttentionList`, `DashboardGrid`, `EmptyState`, `SiteStatus`.
6. Dashboard providers for blog, forms, gallery, media, people; attention rules §3.3.
7. Home rebuilt on the registry: phone layout first, then desktop.
8. /verify per `docs/engineering/client-dashboard/verification.md`.

**Phase 3 — Analytics & Search Console**
9. ADR-028 permission `analytics.read`; GA4 property ID field; `google-search-console` manifest.
10. Service-account adapters (`src/lib/analytics/{ga4,gsc}.ts`), migration `analytics_snapshots`, daily job.
11. `RankedList`, `Sparkline`; traffic + search widgets on home; Analytics page (PageHeader + DateRangePicker + StatGrid + RankedLists).

**Phase 4 — More modules & feature controls**
12. Events and News widgets once their client pages exist.
13. Feature-control pattern (first case: LinkedIn) — registered `featureControl` surface, scoped to the feature.

Phases 1 and 2 can run partly in parallel (components step 5 has no dependency on step 1).

## 7. Decisions (Tom, 2026-10-07)

1. **Analytics visibility:** Owner + Site admin by default; an Editor can be given it as a per-membership extra (like contact requests).
2. **Connection:** one Abluo service account the tenant adds as viewer; GA4 property ID + GSC site URL stored by Abluo admin in Studio. No Google sign-in in the tenant UI.
3. **Phone account menu:** avatar in the top bar; "More" keeps only navigation.
4. **Help:** links to an Abluo help page (help content to be written; link target is configuration, not hardcoded).
