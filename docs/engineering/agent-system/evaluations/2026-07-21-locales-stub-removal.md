# Evaluation — Locales-stub removal (ADR-014 Phase B completion) · 2026-07-21

**Format:** `../maturity-evaluation.md` v1.3 · **Chain:** sanity-content-contracts (structure removal) → release-engineering (gates + readiness v1.1). Both handoffs accepted first-pass. Trigger: Tom found Project Settings → Locales opening the same siteConfig document as Website Settings — a one-surface violation of the same class as the Phase B Analytics stub, missed in Phase B.

**sanity-content-contracts:** 17-line removal + pointer comment; verified no double divider; post-edit grep zero `settings-locales`; remaining items enumerated from the file (General, Modules, Domains, Billing, Integrations, Privacy). Gates 1 + scoped 2 (125/125) clean. All 5s.

**release-engineering:** full v1.1 readiness (11/11): intended==actual (exactly 1 file), no lock, nothing staged, artefacts ignored-and-verified via `git check-ignore`; Gate 2 full suite 317/319 (same I9 pair); one safe next command. Bonus: identified the `origin/backup/*-pre-recovery` refs as dormant V0.8.2-era recovery artifacts (labelled Assumption re: fetch freshness — correctly). All 5s.

**Orchestration criteria:** delegation ownership 5 · self-execution 5 · parallel safety 5 (dependent pair, sequenced) · dependency analysis 5 · fallback 5 (none) · phase-end readiness before guidance 5 · one-command rule 5 · lock handling 5 (verified absent) · boundary notification 5 · noise 5.

**Process note:** the defect was found by Tom in normal Studio use, not by any gate — Studio IA has no structural "one-surface" check. Candidate future gate: a structure-builder test asserting no two Project/Website Settings items resolve to the same document type + filter. Logged as an idea for Phase D or I9 follow-up, not actioned.

**Open:** Tom's local build → commit → dev+preview verification → Phase D → v1.0.15 cut.

**Evaluator:** Orchestrator (this session), pending Tom review.
