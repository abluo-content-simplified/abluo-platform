# Agent Maturity & Evaluation

**Version:** 1.2 · **Status:** Active
**Governing Playbook section:** §3.4 (Agent maturity), §3.2 (Orchestrator synthesis & quality backstop)
**Purpose:** Evaluation record format for Experimental agents and for engineering workflows, and the criteria for promotion, revision, merging, suspension, and retirement.
**Owner:** Orchestrator · **Consumers:** Orchestrator, Tom
**Update conditions:** Playbook §3.4 changes; first promotion (criteria get sharpened by real data).
**v1.1 (2026-07-10):** promotion made explicitly evidence-based; added Evaluation Confidence, Reusability, and workflow-level evaluation. Refinements only — no change to the maturity model itself.
**v1.2 (2026-07-11):** added five orchestration criteria to the workflow record (delegation ownership, orchestrator self-execution, parallel-delegation safety, dependency & shared-file analysis, fallback reporting) — enforcing `.claude/agents/orchestrator.md` *Delegation ownership* / *Fan-out / fan-in* / *Delegation fallback*. Triggered by the 2026-07-11 incident: the orchestrator self-executed a preview smoke test owned by release-engineering instead of fanning it out alongside an independent documentation task. No change to the maturity model or roster.

---

## What gets evaluated

The Orchestrator evaluates **the engineering workflow, not only individual specialists**. Every completed task produces:

1. **One specialist record per participating agent** (today usually one agent; the single-specialist case is simply the smallest workflow).
2. **One workflow record** when a task involved more than one agent or any review stage — e.g. a future chain `Orchestrator → Documentation/Frontend/Sanity → Accessibility Review → Testing Review → Release Review → Orchestrator synthesis`. This does **not** implement multi-agent orchestration; it only keeps today's records compatible with it.

Records are stored in `evaluations/` as `YYYY-MM-DD-<agent-or-workflow>-<task-slug>.md`.

## Specialist evaluation record

```markdown
# Evaluation — <agent> · <task> · <date>

**Workflow context:** single-specialist | position in chain: <e.g. "2 of 4, after sanity-content-contracts">

| Criterion | Score (1–5) | Notes |
|---|---|---|
| Task completion | | done as specified? |
| Scope discipline | | stayed inside owned files? refused out-of-bounds work? |
| Evidence quality | | claims labelled and file-referenced? |
| Unnecessary context loaded | | (5 = none) anything beyond spine + pack? |
| Gate compliance | | required gates run and reported? |
| Escalation correctness | | escalated the right things, and only those? |
| Rework required | | (5 = none) |
| Token/context efficiency | | result vs context consumed |
| Human corrections | | (5 = none) count and severity |
| Reusability | | can another agent immediately reuse this work? (reusable context, documentation, workflow, or evidence — name which) |

**Evaluation Confidence:** High | Medium | Low
<the Orchestrator's confidence in its own evaluation, not in the specialist's work.
High = evidence complete · Medium = some uncertainty · Low = incomplete evidence or limited visibility>

**Handoff accepted:** yes / no (why)
**Verdict:** continue Experimental / candidate for promotion / revise / merge / suspend / retire
**Evaluator:** Orchestrator (+ Tom where required)
```

Reusability supports the system objective (Playbook §0): building persistent engineering knowledge, not isolated outputs. Work whose evidence, context, or procedure feeds a pack, a workflow, or another agent's next task scores high.

## Workflow evaluation record (multi-agent or reviewed tasks)

```markdown
# Evaluation — workflow · <task> · <date>

**Chain:** <agents and review stages in execution order>

| Criterion | Score (1–5) | Notes |
|---|---|---|
| Decision classification | | levels assigned correctly before routing (§3.8)? |
| Routing & pack selection | | cheapest capable agents; only relevant packs loaded? |
| Sequencing | | no shared-file concurrency; sensible order? |
| Handoff quality between stages | | complete, accepted, no information lost? |
| Review-gate coverage | | a11y/security/testing routes taken or explicitly escalated? |
| Synthesis quality | | one coherent, evidence-backed result for Tom? |
| End-to-end efficiency | | rework loops, redundant context across agents |
| Delegation ownership | | routine operational work (smoke tests, deployment verification, version checks, route health, release validation) routed to its owning specialist — release-engineering — rather than self-executed? |
| Orchestrator self-execution | | (5 = none unlabelled) any direct orchestrator execution without a valid, stated exception (specialist unavailable / tooling limitation / Tom's explicit request)? |
| Parallel-delegation safety | | fan-out used only for independent, non-overlapping tasks; nothing dependent or file-overlapping parallelized; sequential correctly chosen when independence unproven? |
| Dependency & shared-file analysis | | independence demonstrated (not assumed) before fan-out; overlapping file sets correctly serialized? |
| Fallback reporting | | every bypass labelled `Delegation fallback — reason: <specific reason>` at execution AND recorded in the final synthesis? |

**Evaluation Confidence:** High | Medium | Low
**Evaluator:** Orchestrator (+ Tom where required)
```

## Promotion criteria (no promotions during Phase 3A)

**Agent promotion is evidence-based.** A count of successful tasks is necessary evidence, but **never sufficient** on its own. This mirrors Playbook §3.4: promotion rests on *demonstrated correctness across repeated tasks*, clearly owned invariants, and a low escalation-error rate — demonstrated, not counted.

Promotion considers, across the agent's evaluation records:

- correctness
- scope discipline
- evidence quality
- token/context efficiency
- consistency over time
- human corrections required
- reusability of outputs

**Promotion at every step — Experimental → Stable and Stable → Core — requires `Tom approves` (Playbook §3.8).** The Orchestrator recommends with evidence; it never promotes.

**Experimental → Stable** — minimum expected evidence (not automatic promotion):
- ≥ 5 successful evaluations with accepted handoffs
- No scope violations in the last 5 tasks
- Escalation correctness ≥ 4 average; zero silently-resolved `Tom approves`/`Tom decides` items ever
- Its owned invariants are written in its pack and none was broken by its work
- Median rework ≤ 1 round
- Evaluation Confidence predominantly High across the records relied upon (Low-confidence evaluations do not count toward the evidence base)

**Stable → Core** — minimum expected evidence (not automatic promotion):
- Guards an invariant whose failure is a platform risk (Playbook §3.4)
- Sustained record at Stable (≥ 10 further successful evaluations, no invariant breaks)
- Its pack is complete and current (no stale sources)
- Consistent reusability: its outputs demonstrably feed packs, workflows, or other agents
- Consequence of promotion: its pack changes become gated (Playbook §3.4)

## Revision / merge / suspension / retirement

- **Revise** when: repeated handoff rejections for the same cause · pack repeatedly stale · scope definition proves ambiguous in practice.
- **Merge** two agents when: they share most pack content · they are always invoked together · handoffs between them carry no real boundary (Playbook §3.4: "their boundary was not real").
- **Suspend** when: an agent breaks an owned invariant or edits excluded files — no further tasks until cause is understood and the pack/definition is corrected.
- **Retire** when: the boundary dissolves or work stops recurring; an Experimental agent that hasn't earned promotion is retired without ceremony (Playbook §3.4). Its pack is archived, not deleted.

## Evidence discipline (P0)

Evaluation records are themselves evidence-first: every score's Notes cites what was observed (handoff section, file, gate output), labelled **Verified fact / Assumption / Hypothesis** where the distinction matters. An evaluation built on assumptions must say so via its Evaluation Confidence.
