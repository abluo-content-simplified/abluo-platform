# New client / New project wizard (admin)

**Where:** admin.abluo.app → Projects → **New project** (`/projects/new`).
**Built on:** ADR-030 (admin on the shared Abluo App layer), ADR-028 (roles, invitations), ADR-029 (admin/tenant boundary).
**Migration:** `supabase/migrations/037_project_provisioning.sql` (proof: `supabase/verify/hardening-037.verify.mjs`). Until 037 is applied the page shows "Apply migration 037 first" and creates nothing.

## What it does

Five steps, then one click:

1. **Client** — an existing client (Supabase `tenants`) or a new one (name + slug).
2. **Project** — name, slug, default language + languages (from the Platform Locale Registry, `src/lib/i18n/locales.ts`).
3. **Design system** — a template, or another site's active system.
4. **Owner** — name + email; invited as the client's **Owner** with the ADR-028 invitation flow (`createInvitation`, tenant scope, `adminAssured`). Required for a new client, optional for an existing one.
5. **Review & create.**

What gets created (ids chosen once, at start):

| Step id | Writes | Id |
|---|---|---|
| `supabase.tenant` | `tenants` row (new client only; status `active`) | fresh UUID |
| `supabase.project` | `projects` row, status **`preview`**, no custom domain | fresh UUID |
| `sanity.client` | `client` doc (skipped when the client already has one) | `client-<tenantSlug>` |
| `sanity.designSystem` | the project's **own** `designSystem` (role `active`) | `ds-<projectSlug>` |
| `sanity.project` | `project` doc → client, Supabase ids, `designSystemRef`; Sanity `status: inactive` (keeps it out of sitemap/llms.txt until launch) | `project-<projectSlug>` |
| `sanity.siteConfig` | `siteName`, `defaultLocale`, `supportedLocales` (same shape as `AutoCreateSiteConfigAction`) | `siteconfig-<projectSlug>` |
| `sanity.homePage` | `page` with `pageType: "home"`, slug `home` per language, one `heroSection` + one `textSection` with placeholder copy per supported language (`placeholders.ts`) | `page-<projectSlug>-home` |
| `invite.owner` | `invitations` row + email (Resend) | — |

Documents are written **published**, in this order (Sanity refuses a reference to a document that does not exist yet).

### Design system copy

`buildProjectDesignSystem()` (`src/lib/admin/provisioning/design-system-copy.ts`):

- picked a **template** → an empty child: `parentDesignSystem` → the template (everything inherited; later template edits still flow in);
- picked another site's **active** system → a copy of that document's own fields (field-agnostic, like Export/Import) with the **same parent**. Same own fields + same parent = same resolved design (a test proves it with `resolveDesignSystemInheritance`).

Either way the new site can be fine-tuned in Studio without affecting any other site.

### Slugs

`validateSlug()` (`model.ts`): 2–40 chars, `a–z 0–9 -`, starts with a letter, no edge or double hyphen, not in `RESERVED_SLUGS` (`src/lib/platform/reserved-slugs.ts` — every first route segment, locale prefixes, admin and client-dashboard segments; a test reads `src/app` and fails on a missing one). Uniqueness is checked on the server against Supabase `projects` (**across all clients** — the database is unique per client since 023, but the URL namespace `preview.abluo.app/<slug>` is flat), Sanity (any document with that `projectSlug`, or one of the planned ids) and open runs.

## Resumable by design

- **Plan once, replay.** `planProvisioning()` (pure, `plan.ts`) turns the input + facts read at start into every row and document. The plan is stored on the run (`project_provisioning_runs.plan`); Retry replays it, never re-plans.
- **Idempotent steps.** Each step reads by its deterministic id first: present and belonging to this project → done; present but someone else's → `conflict` (never overwritten); absent → create (`insert` / `createIfNotExists`).
- **Progress per step.** `steps` jsonb records `done | failed | skipped` with time, error code and message. A failure stops the run (`status: failed`, `current_step`, `last_error`); the screen shows which step failed and **Retry**, which resumes there. Finished steps are not repeated (the Owner is invited once).
- **One executor at a time.** `claimRun()` flips `pending|failed → running` atomically; a `running` run is claimable again only after 2 minutes without progress (a request that died).
- **Never deleted.** Runs, rows and documents are never hard-deleted by the wizard. Unfinished runs are listed on `/projects/new`.

Every server action calls `requireAbluoAdmin()` first and writes the admin audit log (`project.provision.check|start|retry|complete|fail|view`; `project_id` only once the project row exists, because of the log's foreign key).

## What stays manual — and why (routing is build-time)

**Host → project routing is resolved from a generated, checked-in table, not at runtime.** `src/lib/tenancy/generated/route-config.ts` is generated from Supabase (`projects` + `tenants`, plus each siteConfig's languages) by `npm run routes:generate` and read synchronously at the edge by `src/lib/tenancy/host-scope.ts`. The `(website)/[tenant]` layout's 404 guard (`isKnownProjectSegment`) reads the same table. It is **not** regenerated by `next build` (no prebuild hook) — a human runs it and commits the file.

Consequence: a new project is **not reachable anywhere** — not on `preview.abluo.app/<slug>`, not on `localhost/<slug>` — until the table is regenerated, committed and deployed. The final screen says so and lists:

1. `npm run routes:generate`, commit `route-config.ts`, deploy dev → preview → main.
2. Fine-tune the design system and start page in Studio.
3. Domain (by hand): add `<domain>` + `www.<domain>` in Vercel → abluo-platform → Settings → Domains; add the DNS records Vercel shows (typically `A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`); set `projects.custom_domain` (and the Sanity project's Custom Domain); regenerate + deploy; at launch set status `active`, regenerate + deploy again.

Status ladder (`servesOnHostKind`): `draft` serves nowhere; **`preview`** serves on preview/localhost hosts only (never the custom domain); `active` everywhere. New projects start in `preview` (`NEW_PROJECT_STATUS` in `model.ts`) so they appear on their platform URL after the next route regeneration.

**For later automation:** either run the generator + deploy from a pipeline (deploy hook after the wizard), or move host resolution to a runtime store the edge can read (e.g. Vercel Edge Config written by the wizard) and keep the generated file as a fallback. Domains would then be `projects.custom_domain` + the Vercel Domains API.

## Files

```
src/lib/platform/reserved-slugs.ts                  RESERVED_SLUGS + isReservedSlug()
src/lib/admin/provisioning/model.ts                 pure: slugs, input validation, steps, ids
src/lib/admin/provisioning/design-system-copy.ts    pure: the project's own design system
src/lib/admin/provisioning/plan.ts                  pure: the step planner
src/lib/admin/provisioning/placeholders.ts          start-page placeholder copy per locale
src/lib/admin/provisioning/options.ts               server: clients, design systems, availability, start facts
src/lib/admin/provisioning/store.ts                 server: project_provisioning_runs
src/lib/admin/provisioning/runner.ts                server: executes the steps
src/app/[locale]/(admin)/projects/new/page.tsx      wizard / run page
src/app/[locale]/(admin)/projects/new/actions.ts    server actions (requireAbluoAdmin + audit)
src/components/admin/projects/NewProjectWizard.tsx
src/components/admin/projects/ProvisioningRunPanel.tsx
```

Copy: `admin.newProject` (+ `admin.projects.newProject`) in `messages/{en,it,de}.json`.

Tests: `src/lib/admin/provisioning/__tests__/` (model, plan, design-system-copy, runner with in-memory Supabase/Sanity fakes) and `src/lib/platform/__tests__/reserved-slugs.test.ts`.
