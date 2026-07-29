# Evaluation — Sprint 3 tenant-isolation + /studio evidence audit · 2026-07-24

**Format:** `../maturity-evaluation.md` v1.3 · **Chain:** single thorough Supabase & Security specialist (read-only), coherent cross-plane trace (fan-out rejected — the "can A reach B" question spans all planes together). Handoff accepted first-pass. Backstop: orchestrator relayed findings without re-deriving (evidence is file-referenced and checkable).

## The pivotal finding
**No "Abluo admin" identity mechanism exists.** `proxy.ts:255` reads a `user_role` JWT claim that nothing ever sets (`profiles.role` dropped in migrations/004:244; no access-token hook, no app_metadata setter). Consequence: no admin-vs-tenant distinction exists anywhere, so `/studio` gating and every tenant boundary are currently *unenforceable* — not merely unenforced. This is the prerequisite decision blocking all of Tom's three mandates.

## Structural picture
- **Supabase RLS + `tenant_members` membership: well-designed** (SECURITY DEFINER helpers keyed on auth.uid(), per-table select/insert/update/delete policies, tenant key derived from membership not params) — but **bypassed everywhere**: every app path uses the service-role client (`createAdminClient`), so RLS is currently unexercised. Good foundation, unused.
- **Sanity:** public website content correctly scoped via `fetchForTenant`/projectSlug; private/admin paths (`api/sanity/document`, `api/media`) take tenant from spoofable params or omit scoping — holes.
- **API routes:** most unauth + unscoped (service role / write token); even the F1-fixed `media/[id]` lacks a tenant-ownership check.
- **Dashboards:** URLs (`/en/dashboard`, `/en/media`, `/en/leads`) don't match proxy `PROTECTED_PREFIXES` (`/admin`,`/client`) — unguarded off the admin host; admin host gate is "any authenticated user." Client dashboard is stubbed → no live per-tenant read path yet (model must be decided before it's built).

12-gap table (8 P0) in the handoff. The P0s compound into one systemic exposure: any authenticated tenant user is a de-facto platform admin.

## Two Tom-decides forks (prerequisites, cannot proceed without)
1. **Abluo-admin identity mechanism** — options: `app_metadata` admin role via a Supabase custom access-token hook (JWT claim, what proxy.ts already half-expects) · an `is_admin`/admin-allowlist table · a dedicated admin tenant. Nothing exists; must originate here.
2. **Where isolation is enforced** — RLS (stop using service-role for user requests; let the well-built policies do their job) · app-layer membership checks · both (defense in depth). Recommendation leans RLS-primary + app-layer ownership checks, since the RLS already exists and is sound.

## Scores
Specialist: completion 5 · scope 5 (all three planes + studio + the admin-identity question) · evidence 5 (every claim file:line, live-request caveat stated) · gates 5 (n/a, security deliverable) · escalation 5 (surfaced the pivotal blocker, resolved nothing unilaterally) · efficiency 4 (143K — large but the breadth warranted it; a coherent single trace was worth more than cheaper fragments). **Continue Experimental — second strong task validates standing up this specialist.**

## Next
Tom rules on the two forks → documentation drafts the authorization ADR (the platform's most important) from this evidence base → phased implementation paired with I9. The F1 hotfix already proved the per-route auth+ownership pattern; this generalizes it platform-wide.

**Evaluator:** Orchestrator (this session), pending Tom review.
