# Plan — separate data for dev (draft for Tom, 2026-11-05)

**Goal (Tom):** test on dev; nothing created there is visible on preview or production until it is promoted.
**Status:** plan only, not started. To review Monday 2026-11-09. Supersedes the "no new datasets" part of `shared-environments.md` (decision of 2026-10-20) once approved.

## Target

| Stage | Code | Supabase | Sanity dataset |
|---|---|---|---|
| local + dev.abluo.app | `dev` branch | **Abluo Sandbox** (exists) | **`development`** (new) |
| preview.abluo.app | `preview` | Abluo production project | `production` |
| abluo.app / admin | `main` | Abluo production project | `production` |

Preview keeps the real data on purpose: it is where clients review their real content.

## What moves on promotion
- **Code:** git, as today.
- **Database schema:** migrations run on Sandbox (= dev) first, then on production at promotion. This is already our flow.
- **Content and configuration made while testing** (courses, sections, module switches, test pages): stays on dev. What must go live is entered on production, or copied deliberately with `scripts/env/copy-docs.mjs <ids>`.

## Work items

| # | Item | Est. dev-days |
|---|---|---|
| 1 | Check the Sanity Growth plan dataset quota; create the `development` dataset (private), CORS for dev/localhost, the Sanity webhooks for dev | 0.5 |
| 2 | Vercel: environment variables for the `dev` branch → Sandbox Supabase URL/keys + `NEXT_PUBLIC_SANITY_DATASET=development`; local `.env.local` stays production for scripts, plus a new `.env.development.local` | 0.5 |
| 3 | Code audit: hard-coded `'production'` dataset names, production-ref guards (`supabase-target.ts`), Studio host rules (`proxy.ts`), `/api/version` reporting, Sanity read token scope | 1–2 |
| 4 | `scripts/env/refresh-dev.mjs`: copy Sanity `production` → `development` (dataset copy or export/import), seed Sandbox with tenants, projects, members, module installs, billing stubs; exclude personal data (form submissions, `person_private`, bookings later); refuses to write to production | 1–2 |
| 5 | Logins on dev (Sandbox auth users: Tom + test client accounts via the invite script), emails (production-only gate already), crons (production only), Stripe (test mode already) | 0.5 |
| 6 | Runbook + update `shared-environments.md`, CLAUDE.md "Where things live" | 0.5 |
| **Total** | | **≈ 4–6 dev-days, ~2–3 days with Claude + 1–2 h of Tom in dashboards** |

## Risks / trade-offs
- dev content goes stale between refreshes (run `refresh-dev` when needed).
- Separate logins on dev.
- Sandbox on the free tier may pause; keep-alive or upgrade.
- Two datasets count toward the Sanity quota.
- Once dev has its own data, testing a client's real page on dev needs a refresh first.

## Decisions for Tom
1. Confirm the Sanity dataset quota / any cost.
2. Is a weekly refresh enough, or on demand only?
3. Should preview stay on production data? Recommended: yes.
