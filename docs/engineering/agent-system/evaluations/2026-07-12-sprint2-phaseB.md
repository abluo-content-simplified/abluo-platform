# Evaluation — Sprint 2 Phase B (Studio panes + IA rewire, ADR-014) · workflow + specialists · 2026-07-12

**Governing Playbook sections:** §3.4, §3.6, §5.6 · **Format:** `../maturity-evaluation.md` v1.2
**Chain:** release-engineering (baseline) ∥ sanity-content-contracts (live-data check) — **fan-out** → sanity-content-contracts (slice 1: schema/queries/types) → sanity-content-contracts (slice 2: panes + structure) → documentation (register) → release-engineering (final gates). All 6 handoffs accepted first-pass (26/26 across the engineering-OS era).

## Orchestration criteria (v1.2)

| Criterion | Score | Notes |
|---|---|---|
| Delegation ownership | 5 | Baseline + final gates → release-engineering; live-data check → sanity (its own Schema Evolution Rule); zero orchestrator self-execution |
| Orchestrator self-execution | 5 | None; only orchestration artifacts authored |
| Parallel-delegation safety | 5 | First real fan-out executed: git baseline ∥ Sanity data check — independent, read-only, no shared files; docs/gates correctly sequenced again (changed-file-list dependency) |
| Dependency & shared-file analysis | 5 | Slice 1 → slice 2 sequenced within one domain (schema shapes consumed by panes); analysis stated before routing |
| Fallback reporting | 5 | No fallback used |

## The finding that shaped the phase

The fan-out's Sanity leg invalidated a premise: production now holds live GA4 data (`studiomartegani-main`: `analyticsEnabled: true`, `googleAnalyticsId: G-3KZZWHBLVR`) inside the object ADR-014 Phase B was slated to remove. The Schema Evolution Rules check — run because the rules demand it, not because anyone expected data — prevented silently breaking a paying client's analytics. Orchestrator ruling (flagged to Tom in-flight, `AI recommends`): Phase B stays additive/move-only; the `integrations` removal defers to Phase C to ship in the same deployable unit as the runtime switch (P6); migration by admin re-entry via the new pane instead of a production mutation script. Verification tokens (verified empty everywhere) moved now as planned.

## Specialist findings (compact)

**release-engineering (×2):** baseline verified Phase A on both remote branches (and corrected a 15-vs-16 file-count error in the orchestrator's brief — evidence over premise again); final gates: Gate 1 clean, Gate 2 302 tests / 300 pass (82/82 integrations), correctly emphasized Gate 3 is *not optional* this phase (sanity.config.ts is build-relevant). All 5s.

**sanity-content-contracts (×3 — data check, slice 1, slice 2):** the data check found the live-data premise shift and proposed migration sequencing without touching anything (escalation as designed). Slice 1: clean move of verification tokens with byte-level confirmation the rest of the integrations object is untouched and the layout.tsx alias contract preserved without editing that file. Slice 2 (largest UI task to date, ~173K tokens): panes built on the *actual* raw-HTML precedent after discovering `@sanity/ui` isn't installed (brief said otherwise — evidence overrode instruction, correctly, second occurrence of this pattern); ADR-013 hardening reproduced in the customScripts editor; a11y self-review with concrete mechanics (aria-invalid, role=alert, labelled controls); honest §7 notes (patch selector unexercised against live data, draft-id assumption, lint-debt precedent now in 3 files). Scores: completion 5 · scope 5 · evidence 5 · gates 5 · escalation 5 · efficiency 4 (slice 2) · reusability 5. **Continue Experimental — now 7 consecutive accepted handoffs this sprint.**

**documentation:** register updated in three places, all claims source-verified to line numbers, stale Phase A phrasing trimmed, stayed inside the ~6-line budget. Fifth consecutive clean round. All 5s.

## Workflow findings

1. First production fan-out worked and mattered — parallel verification surfaced the live-data finding earlier than a sequential chain would have.
2. The Schema Evolution Rules + Evidence First combination is now 2-for-2 at preventing shipped incidents (MetricsSection class June 2026; studiomartegani GA4 today).
3. Phase-boundary discipline held under temptation: slice 2 could easily have "helpfully" removed the integrations group; it did not.
4. Standing constraints: Gate 3 still requires Tom's local build — **elevated this phase** (sanity.config.ts touched); I9 flakes persist (302-test suite).

**Open items leaving this workflow:** Tom's local build (mandatory) + Phase B commit · ADR-014 phasing deviation ratification (removal deferred to C) · migration-by-re-entry approval · Gate 5 formal review of the two panes · Phase C start.

**Evaluator:** Orchestrator (this session), pending Tom review.

---

## Revision — Tom rejected the phasing deviation (same day)

Tom's ruling: follow ADR-014 Phase B **as accepted** — remove `siteConfig.integrations` now; a temporary GA4 interruption for studiomartegani is acceptable (he re-enters the ID in the new pane); one configuration surface and one storage model must exist after Phase B. The orchestrator's `AI recommends` deviation was correctly classified (proposed, not enacted — nothing had shipped) and correctly overridden: **the decision-ownership system worked; the recommendation was simply not taken.**

**Revision chain (3 delegations, all accepted first-pass — 29/29 era total):**

1. **frontend-sections** — TrackingScripts import + all 4 mounts removed from layout.tsx (grep-verified 4→0); component + tracking lib + 26 tests preserved for Phase C; Phase C breadcrumb comment left. Sequenced FIRST deliberately: removing the type property before the mounts would have put Gate 1 red mid-phase. All 5s.
2. **sanity-content-contracts** — entire `integrations` object + group removed from siteConfig (−176 lines), projection removed, `WebsiteSiteConfig.integrations` removed; transitional component types kept with re-source note; Gate 4 grep audit listing every remaining `integrations`-adjacent reference with justification; orphaned-data cleanup patch proposed for the studiomartegani doc (`unset(['integrations'])` after Tom's re-entry — `Tom decides`, not executed). All 5s.
3. **documentation** (cheap tier) — register: Integrations-group table replaced with removal note; registry section updated (no more "authoritative until Phase C" phrasing). All claims source-verified. All 5s.
4. **release-engineering** — Gates re-run: 1 clean; 2 = 300/302 (both I9 flakes fired this run; 82 integrations + 26 tracking green); 3 NOT RUN (mandatory locally — sanity.config.ts + layout.tsx + schema removal all build-relevant); 7 baseline clean, changed-file set exact match. Improved the commit message to state 300/302 explicitly so the record doesn't overstate gate status — good truthfulness instinct. All 5s.

**Orchestration criteria (revision):** delegation ownership 5 · self-execution 5 (none) · parallel safety 5 (revision chain fully dependent — correctly zero fan-out) · dependency analysis 5 (frontend-before-sanity ordering prevented a mid-phase red gate) · fallback reporting 5 (none used).

**Post-revision state:** one configuration surface (Project Settings → Integrations + Privacy), one storage model (`project.integrationConfigs` + `project.privacy`), verification tokens in `seo`, tracking emission paused until Phase C by explicit acceptance. Orphaned stored data on one production document pending re-entry + cleanup patch.

**Evaluator:** Orchestrator (this session), pending Tom review.
