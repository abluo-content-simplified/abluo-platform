# Evaluation — Sprint 3 ADR-015 immediate-hardening tranche + ADR acceptance · 2026-07-24

**Format:** `../maturity-evaluation.md` v1.3 · **Chain:** fan-out — documentation (ADR-015 → Accepted, R1–R8 marked accepted) ∥ Supabase & Security specialist (hardening tranche) — independent files (docs/architecture vs src/app/api), genuine fan-out. Then release-engineering phase-end readiness. All 3 handoffs accepted first-pass.

## Orchestration criteria (v1.3)
delegation ownership 5 · self-execution 5 · parallel safety 5 (doc-accept ∥ code-harden, zero file overlap — correct fan-out) · dependency 5 · fallback 5 · phase-end 5 (readiness ran; clean 2-commit split proposed; ONE next command) · notification/noise 5.

## What shipped (working tree, uncommitted)
ADR-015 **Accepted** (R1–R8 accepted). Hardening tranche closed the live unauth P0 routes: `sanity/document`, `media` GET+POST, `media/tags`, `sanity/{tenants,tenant,projects}` all now `requireAuthenticatedUser()` 401-gated (interim "any-auth" gate — safe today, no tenant users exist; all 6 are admin-surfaces flagged for the platform_role admin upgrade in Phase 1). Media GROQ string-interpolation replaced with parameterized `buildMediaFilter()` (R2, kills injection; 9 tests). `fix-colors` GET-mutation removed (dead code, 0 refs → `git rm`). Gates: tsc clean, 333/335 (I9 pair), build mandatory locally.

## Two specialist judgments worth recording
1. **`inquiries/[id]` PATCH correctly NOT gated.** The specialist traced the caller — it's the early-access marketing form's step-2/3 public completion (`EarlyAccessModal.tsx:850`), no session. Session-auth-gating would break the funnel. Correctly left unchanged and flagged for a signed-token/ownership approach in the model tranche. Exactly the "don't ship a fix that breaks real usage" discipline the F1 caller-trace established — evidence over reflex.
2. Sandbox can't unlink `fix-colors` (FUSE), so it was neutralized to a 410 stub in-tree with the `git rm` handed to Tom — honest about the environment limit rather than pretending deletion.

## Scores
Supabase & Security: completion 5 · scope 5 (hardening only — explicitly did NOT implement platform_role/ownership, those are later phases) · evidence 5 (per-route file:line, caller trace) · gates 5 · efficiency 4 (99K) · reusability 5 (buildMediaFilter + the reused F1 gate pattern generalize). **Continue Experimental — 3 strong tasks (F1, tenant audit, hardening); a promotion-case is accumulating.** Documentation (haiku): clean surgical status flip, 5s. release-engineering: reconciled the stale HEAD (v1.0.17 already on main), proposed the reviewable 2-commit split, substantiated Gate 3 EPERM rather than asserting it. 5s.

## Open / next
- Tom: restore churn → Commit A (hardening) → local build → Commit B (docs) → release v1.0.18 → dev/preview/main STOPs.
- Residual P0 not in this tranche: `inquiries/[id]` (needs signed-token, model tranche).
- **Next slice: Track 2 Phase 1 identity foundation** — platform_role in app_metadata + custom access-token hook (Supabase env), first-admin seed + existing-user backfill + forced re-auth (R5), central AuthenticatedActor resolver, multi-tenant membership context, gate /studio on abluo_admin (R6). Involves Tom's Supabase environment actions. Report the consolidated milestone after hardening + Phase 1 both land (Tom's checkpoint).

**Evaluator:** Orchestrator (this session), pending Tom review.
