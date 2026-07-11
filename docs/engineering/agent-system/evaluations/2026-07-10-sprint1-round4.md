# Evaluation — Sprint 1 Round 4 (fail-closed consent mode) · all four specialists · 2026-07-10

**Governing Playbook sections:** §3.4, §3.6, §5.6 · **Format:** `../maturity-evaluation.md` v1.1 (consolidated round record)
**Trigger:** Tom's final safety clarification (`Tom decides`, settled): `consentModeEnabled: true` with no valid consent state fails closed for EVERYTHING except admin-approved Necessary custom scripts — GA4, GTM, Meta Pixel, and Analytics/Marketing/Functional custom scripts all blocked. "Consent mechanism ships later" is not permission to load tracking without consent. This closes the built-ins-pre-consent question deferred in Round 3.
**Sequence:** sanity-content-contracts → frontend-sections → documentation → release-engineering. 4/4 handoffs accepted first-pass (16/16 sprint total).

## Per-specialist findings and scores (compact)

### sanity-content-contracts
Surgical: two description-string updates (`consentModeEnabled`, `consentCategory`) to the new semantics; correctly identified that `consentCategory`'s old description was factually wrong on two counts (future-only framing; missing Functional) and that `analyticsEnabled` needed no change (no consent claim). Gate 1 pass; Gate 4 no-shape-drift confirmed byte-level. Correctly noted in §7 the description-vs-implementation timing gap while frontend's slice was pending.
Scores: completion 5 · scope 5 · evidence 5 · context 5 · gates 5 · escalation 5 · rework 5 · efficiency 5 (57K, smallest of sprint) · corrections 5 · reusability 4. **Continue Experimental.**

### frontend-sections
`ConsentState` + `functional`; `filterCustomScripts` gates functional identically; `consentStateFor(true)` → all-false; new `builtInTrackingAllowed()` (`consentModeEnabled !== true`) gating all four built-in blocks including the bodyEnd GTM noscript. Test suite restructured honestly (26 actual vs the brief's ~28 estimate — reported the discrepancy rather than padding). Verified layout.tsx untouched via git diff. §7 correctly flags the behavior change for any tenant already at `consentModeEnabled: true` as a release-note item.
Scores: completion 5 · scope 5 · evidence 5 · context 5 · gates 5 · escalation 5 · rework 5 · efficiency 5 (85K) · corrections 5 · reusability 5 (`builtInTrackingAllowed` is the single swap-in point when real consent arrives). **Continue Experimental.**

### documentation
ADR-013 Consent section rewritten with per-category behavior table; all stale "deferred" framing about built-ins removed (grep-verified only unrelated "deferred" mentions remain); Consequences updated to the narrowed residual gap (analyticsEnabled=true + consentModeEnabled=false tenants). All code claims independently verified against source down to line numbers, including the schema descriptions written minutes earlier. Status Proposed preserved and verified pre/post.
Scores: completion 5 · scope 5 · evidence 5 · context 5 · gates 5 (n/a + substitutes) · escalation 5 · rework 5 · efficiency 5 (74K) · corrections 5 · reusability 4. **Continue Experimental — three consecutive clean rounds since the round-1 defect.**

### release-engineering
Gates re-run fresh: Gate 1 clean; Gate 2 218/220 (26 tracking green; same 2 pre-existing flakes, four rounds running); Gate 3 correctly not re-attempted. Independently read the round-4 code in full before accepting the delta description. Caught that the round-3 commit message wording ("consent-ready filtering") is now inaccurate and proposed corrected wording; flagged that the round-4 evaluation record referenced in the commit list did not yet exist (it does now — this file).
Scores: completion 5 · scope 5 · evidence 5 · context 5 · gates 5 · escalation 5 · rework 5 · efficiency 5 (92K) · corrections 5 · reusability 5. **Continue Experimental.**

## Workflow findings (round 4 + sprint close)

1. **16/16 handoffs accepted first-pass over four rounds.** No boundary violations, no unilateral resolution of a `Tom approves`/`Tom decides` item, in any round.
2. **Decision lifecycle demonstrated end-to-end:** built-ins-pre-consent went deferred-and-documented (R3) → `Tom decides` → decided → implemented + documented + stale framing purged (R4). This is §3.8 working as written.
3. **Cross-agent consistency held without direct coordination:** schema descriptions, filter logic, component gating, ADR text, and build log all state the same rule, each verified independently by its owner — sequenced solely through the Orchestrator per §3.6.
4. **Test-count integrity:** suite growth (194→211→216→220) exactly tracks tracking-test growth (0→17→22→26); the only failures in every round are the two pre-existing I9 module-registry flakes.
5. **Standing constraints unchanged:** Gate 3 structurally impossible in sandbox (Tom's local build required); I2 tag-case split-brain awaits Tom.

**Sprint totals (final):** 16 delegations · 0 rejected handoffs · 1 caught P0 defect (fixed R2) · 2 above-brief evidence discoveries (React 19 script precedent; I2 root cause) · 26 new tests · ADR-013 drafted Proposed through 4 iterations.

**Evaluator:** Orchestrator (this session), pending Tom review.
