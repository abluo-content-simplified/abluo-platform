# Evaluation — Sprint 3 / I1 Security Hardening: evidence sweep · 2026-07-23

**Format:** `../maturity-evaluation.md` v1.3 · **Chain:** fan-out — release-engineering (baseline) ∥ bounded security-evidence sub-agent (Playbook §3.7 throwaway; no standing Supabase & Security specialist exists). Both read-only, no file overlap. Both handoffs accepted first-pass.

## Orchestration criteria (v1.3)
Delegation ownership 5 (baseline → release-eng; security sweep → a §3.7 throwaway, the correct pattern for a bounded evidence task with no owning specialist) · self-execution 5 · parallel safety 5 (two independent read-only audits, genuine fan-out) · dependency analysis 5 · fallback 5 (none) · phase-end 5 (n/a — read-only, no commit guidance) · notification/noise 5.

## Baseline (release-engineering)
Governance I8 commit DID land — `5962800` on origin/dev (CLAUDE.md + pack, 2 files), tree clean, dev 1 ahead of preview/main (unpromoted, correct). Gates: tsc clean, 321/323 (I9 pair). 13 live API route files enumerated; flagged empty `fill-tenant/` dir. All 5s.

## Security sweep (throwaway §3.7 agent) — the material result
**All five Phase 2A I1 findings are STILL OPEN in production.** Root cause confirmed: `proxy.ts:385` matcher excludes `/api`, so the only auth guard never runs for any API route; no handler self-gates except `media/migrate`. 14 findings, severity-ranked with file:line, every claim labelled. Standout **live P0 (F1): `media/[id]` DELETE removes ANY Sanity document by id, unauthenticated, no `_type` guard** (`[id]/route.ts:134`) — arbitrary destruction of page/siteConfig/designSystem/any tenant's content in the production dataset. Plus F2/F3 unauth media PATCH/create, F5 service-role tenant/project reads leaking all tenants, F6 verify-token prefix leak, F7 unauth inquiry-PII PATCH, F11 GROQ injection via string interpolation, F12 /studio fully open. Two severities correctly held as conditional pending live-env facts (F8 MIGRATION_SECRET value, F10 dataset write-ACL). Exemplary evidence discipline — static-analysis-derived, no live requests fired, no severity overstated.

## Gate 6 status
RED at HEAD by its own text — Playbook metric "0 unauth mutating routes" not met (≥5 remain). This is the platform's standing P0 (Playbook I1 = Critical), now confirmed live on a platform serving two paying clients.

## Open decisions for Tom (from the sweep §8)
- **`Tom decides`:** the auth model for `/api` — broad matcher inclusion vs. a shared `requireAdmin()` helper per handler (sweep recommends the per-handler helper). Gates F1/F2/F3/F5/F7/F9 implementation.
- **`Tom decides`:** `/studio` gating (F12) — enforce admin session vs. accept (Sanity's own login still applies).
- **Confirm against live env before finalizing:** F8 (`MIGRATION_SECRET` set?), F10 (production dataset write-ACL).
- Playbook dependency note: pair I1 remediation with **I9** (add API-auth tests) so the fix is gate-protected.

**Next:** Tom rules on the two `Tom decides` items; then a Supabase & Security implementation slice (this may justify standing up that specialist per §3.3 — recurring work + owned invariant now demonstrated). Recommend fixing F1 first regardless of the broader auth-model choice — it is a live destructive exposure.

**Evaluator:** Orchestrator (this session), pending Tom review.
