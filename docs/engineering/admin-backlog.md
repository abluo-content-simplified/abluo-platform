# Admin backlog

`admin.abluo.app/backlog` — the Abluo team's technical backlog: bugs, improvements,
ideas and tasks for the platform, modules, both dashboards and client websites.
ADR-030 §5.5. **Internal only** — clients never see it.

## Storage

Table `public.admin_backlog_items`, migration `supabase/migrations/034_admin_backlog.sql`
(**not applied** until Tom applies it). Server-only: RLS on, no grants to `anon` /
`authenticated`, no policies. Read and written with the service role, always behind
`requireAbluoAdmin()` (abluo_admin + two-factor):

- page `src/app/[locale]/(admin)/backlog/page.tsx` — calls `requireAbluoAdmin()` before
  the service-role read (the `(admin)` layout gate runs too);
- server actions `src/app/[locale]/(admin)/backlog/actions.ts` — each calls
  `requireAbluoAdmin()` first and returns `forbidden` when it is null;
- data layer `src/lib/admin/backlog.ts` — re-checks `platformRole === 'abluo_admin'`
  before touching the database. Pure rules (vocabularies, validation, filtering,
  sorting) are in `src/lib/admin/backlog-model.ts`, tested in
  `src/lib/admin/__tests__/backlog.test.ts` (which also checks the vocabularies match
  the migration's CHECK constraints).

While the table is missing the page shows "Backlog storage isn't set up yet — apply
migration 034" instead of failing (Postgres `42P01` / PostgREST `PGRST205`).

## Fields

| Field | Meaning |
|---|---|
| `title` | What needs doing, one line, required, ≤ 200 characters. |
| `body` | Notes in plain text (markdown-ish, shown as written in a monospace block): details, steps to reproduce, acceptance criteria. ≤ 20 000 characters. |
| `type` | `bug` (something is broken) · `improvement` (works, could be better) · `idea` (not decided yet) · `task` (decided work, e.g. a migration to apply). |
| `area` | Where it lives: `client_dashboard`, `admin`, `module`, `website` (a client's public site), `platform` (shared code, schemas, auth …), `infrastructure` (Vercel, Supabase, Sanity, DNS, CI), `other`. |
| `priority` | `p0` urgent — production broken or a client blocked, drop everything · `p1` high — next up · `p2` normal (default) · `p3` low — some day. |
| `status` | `inbox` (new, not triaged) → `planned` → `in_progress` → `done`; `blocked` (waiting on someone/something — say what in the notes); `wont_do` (decided against — say why). |
| `project_id` | Optional: the client project it is about. Deleting the project keeps the item (set null). |
| `module_id` | Optional: the module id it is about (`forms`, `gallery`, `translate` …), lower-case. |
| `links` | Up to 20 `{label, url}` — ADRs, commits, PRs, feedback docs. Only absolute `http(s)` URLs are accepted. |
| `created_by` / `updated_by` | The admin who created / last changed it. |
| `created_at` / `updated_at` | `updated_at` is set by the shared `set_updated_at()` trigger. |
| `done_at` | Set by trigger when the status becomes `done`, cleared when it leaves `done`. |
| `sort_order` | Manual order within a status (lower first, fractional). New items and status moves go to the end of their status. No drag-to-reorder UI yet. |

## Using it

- **New item** (top right) opens the side panel form. Only the title is required; the
  defaults are `task` · `platform` · `p2` · `inbox`.
- The list hides `done` and `wont_do` by default (status filter "Open"). Filters: status,
  priority, type, area, client project; search covers the title, notes, module, project
  name and links (every word must match).
- Default order: priority, then status in workflow order, then manual order, then most
  recently updated. Title, Priority, Status and Updated headers sort on computers.
- Click a row (or card on a phone) for details. From there: change the status (applies
  at once, goes back with a message if the server refuses), Edit, or Delete (asks first;
  deleting is permanent — prefer `wont_do` to keep the reasoning).

## Later

- Import: Tom's markdown feedback list (project doc `client-dashboard-feedback.md`)
  could be imported as items with a one-off script (one item per bullet, type/area
  inferred, a link back to the doc). Not built.
- Drag-to-reorder within a status (`sort_order` is ready for it).
