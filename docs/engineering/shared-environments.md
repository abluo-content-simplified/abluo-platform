# Environments and the Abluo Sandbox (Events 2.0, Phase 1)

**Decided by Tom, 2026-10-20.** Authority: ADR-038 D8.

## Setup (unchanged)
dev.abluo.app, preview.abluo.app, www/admin (production) and local `.env.local` all use the **existing Abluo Supabase project** (`xsdamzirepfqlutvqfbe`) and the Sanity `production` dataset. This stays as it is in Phase 1: no new Sanity datasets, no environment rewiring, no staging infrastructure.

What that means in practice: dev and preview are separate *code* stages, not separate data. Anything written while testing on dev is real data.

## Abluo Sandbox
One extra Supabase project, **Abluo Sandbox**, with its own credentials in `.env.sandbox.local` (git-ignored; template `.env.sandbox.example`; never copied from `.env.local`).

Use it for:
- rehearsing every database migration before it touches the Abluo project;
- testing scheduling logic and anything destructive;
- automated suites and seed scripts that write data.

## Flow for a migration
1. Run it on Abluo Sandbox and verify it.
2. **Stop. Tom approves.**
3. Apply the same additive SQL to the existing Abluo project. Nothing reads the new tables until the code that uses them is released.

## Guards (in code)
- `src/lib/environments/supabase-target.ts` holds the production project ref. `assertSandboxSupabase()` refuses a missing sandbox or the production project.
- `vitest.live.config.ts` takes Supabase credentials only from `.env.sandbox.local` and calls the guard. Live suites call it too.
- A test fails if any `*.live.test.ts` does not call the guard.
- Any new seed or rehearsal script that writes must call it first.

Operational scripts that are *meant* to act on real data (e.g. `invite-test-client.mjs`, the taxonomy seeds for a live site) are not test scripts and are unchanged.
