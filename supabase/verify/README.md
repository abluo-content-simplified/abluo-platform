# Live-DB RLS verification harness

Standalone from the app's `npm run build`/`npx vitest run` gates by design —
this directory has its **own** `package.json`, `node_modules`, and vitest
config so a missing local Postgres binary can never break the platform's
normal CI/gate commands. Nothing here is imported by `src/`.

## What this proves

The in-memory suite (`src/lib/api/__tests__/cross-tenant-isolation.test.ts`)
only exercises the pure assembly functions (`assembleProjectGrants`,
`permissionsForRole`) — it can never catch a missing `GRANT` or a recursive
RLS policy, because it never talks to a real Postgres. This harness spins up
a **real, disposable, local** PostgreSQL 18 server (via the `embedded-postgres`
npm package — a real `postgres`/`pg_ctl` binary, downloaded once from npm,
not Docker, not Supabase CLI, not production), applies `schema.sql` +
migrations 001–013 (+ 014 draft, when testing it) verbatim, then runs SQL
**as the `authenticated` Postgres role**, with `request.jwt.claims` set per
test to simulate a real Supabase session — exactly the two privilege layers
(GRANT + RLS) a request actually goes through in production. This is the
exact bug class that bit slice 4 three times: migration 011 (missing
`GRANT SELECT`), migration 013 (recursive policy), and (implicitly) the
`inquiries` P0 (zero grants + zero policies = deny-all... except the route
never even asked the DB, since it used the service-role client instead).

## How it was stood up (reproducible)

No Docker was available in this sandbox (`docker --version` → not found), no
`sudo`/root (`apt-get install postgresql` → permission denied on the dpkg
lock). Supabase CLI was not attempted for the same reason — it also shells
out to Docker. Instead:

```bash
cd supabase/verify
npm install          # installs embedded-postgres + pg + vitest, LOCAL to this folder only
```

`embedded-postgres` downloads a real PostgreSQL 18 server binary for the
host platform (linux-arm64 in this sandbox) from npm as a platform-specific
optional dependency (`@embedded-postgres/linux-arm64` etc. — the same
pattern esbuild/sharp use) — no system package manager, no root, no Docker
daemon required. It is started as a plain child process listening on
`127.0.0.1:54329` (configurable), with a disposable `databaseDir` under
`supabase/verify/.pgdata` (gitignored — delete freely to reset).

## What the shim adds that a bare Postgres doesn't have

A bare `postgres` has no `auth` schema, no `authenticated`/`anon`/
`service_role` roles, and no `auth.uid()`/`auth.jwt()` — those are
Supabase-platform features, not Postgres features. `auth-shim.sql`
(applied once, before `schema.sql`) creates the minimal, faithful subset the
migrations actually depend on:

- Roles: `anon`, `authenticated`, `service_role`, `authenticator` (mirrors
  Supabase's role model — `authenticator` is the login role PostgREST
  connects as, then `SET ROLE` into one of the other three per-request).
- `auth.users` — minimal columns (`id uuid`, `raw_user_meta_data jsonb`,
  `raw_app_meta_data jsonb`) — enough for the FK from `public.profiles`/
  `tenant_members`/`project_members` and for `handle_new_user()` to fire.
  Real Supabase's `auth.users` has ~30 columns; only the ones this schema's
  triggers/FKs touch are reproduced.
  Real `raw_user_meta_data`/`raw_app_meta_data` type names.
- `auth.uid()` — reads `request.jwt.claims -> 'sub'` from
  `current_setting()`, exactly like real Supabase's implementation
  (verified against Supabase's published `auth.uid()` source).
- `auth.jwt()` — returns the full claims JSON.
  `auth.role()` — reads `request.jwt.claims ->> 'role'`.
- A helper, `set_session_auth(user_id, role, extra_claims jsonb)`, used by
  the test suite (not by the migrations) to simulate "log in as this user"
  for the current Postgres session: does `SET ROLE <role>` +
  `SELECT set_config('request.jwt.claims', ..., false)`.

None of this is applied to any Supabase project (dev/preview/prod) — it
lives only inside the disposable local `embedded-postgres` instance.

## Running it

```bash
cd supabase/verify
npm install                    # first time only
npm run verify                 # boots Postgres, applies schema+migrations, runs the suite, tears down
```

Or, to inspect the running instance interactively while iterating:

```bash
npm run verify:keep-alive      # boots + applies, leaves the server running, prints the connection string
# in another shell:
node_modules/.bin/psql ...     # or any Postgres client, e.g. `psql "postgresql://postgres:postgres@127.0.0.1:54329/postgres"`
# Ctrl+C the first process when done — it shuts the server down and deletes .pgdata
```

## Recommendation: CI gate vs. documented local-verify step

**Recommended: documented local-verify step, not yet a CI gate.**

- It CAN become a CI gate — `embedded-postgres` needs no Docker/root, so it
  would work unmodified in GitHub Actions (a normal Ubuntu runner has npm
  network access and can run the downloaded binary directly).
- Recommending *against* wiring it into the gate today for three reasons:
  (1) it is new and unproven outside this one sandbox — Tom's own machine
  and any CI runner need to confirm `embedded-postgres`'s binary download
  and startup actually work there too, which is a "try it once, watch it
  pass" step this handoff cannot do for him; (2) it adds meaningful runtime
  (Postgres init + start + full migration replay is several seconds, vs.
  the in-memory suite's milliseconds) to every gate run, which the release
  workflow's "tsc + vitest + build, every release" cadence should absorb
  deliberately, not by default; (3) the existing gate command
  (`npx vitest run`) must keep working with zero setup for anyone who
  hasn't run `npm install` in `supabase/verify` — keeping this suite in a
  separate `package.json`/config, invoked by a separate documented command,
  guarantees that.
- Suggested promotion path: once Tom runs `npm run verify` successfully
  locally a few times (and once on whatever CI runner is in use, if any),
  promote it into `docs/release-workflow.md`'s pre-commit checklist
  alongside `npx tsc --noEmit` / `npx vitest run` / `npm run build`, and
  optionally wire a CI job. Do not promote it silently — this is a
  recommendation, not a decision (per this task's boundaries).
