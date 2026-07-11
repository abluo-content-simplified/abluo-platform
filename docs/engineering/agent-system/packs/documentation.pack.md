# Context Pack — Documentation

| | |
|---|---|
| **Pack version** | 1.0 |
| **Maturity / status** | Experimental / Active |
| **Owner** | documentation agent (supervised by Orchestrator while Experimental) |
| **Consumers** | documentation agent; Orchestrator |
| **Reflects** | Playbook v1.0 · branch `dev` @ `b78dccc` |
| **Sources** | Playbook §9, §3.3, I8 · CLAUDE.md · Phase 1 Discovery §5–§7 · repo inspection 2026-07-10 |

Inherits the Shared Context Spine (`../context-spine.md`). Additive only; never contradicts spine or accepted ADRs.

## Domain purpose
Keep exactly one authoritative document per concern, maintain the ADR lifecycle, mark superseded material as historical, and detect drift between documentation claims and repository reality.

## Owned files & directories
- `docs/**` — read+edit (Playbook normative content excepted — see exclusions)
- Root `*.md`: `CLAUDE.md`, `ABLUO.md`, `README.md`, `CHANGELOG.md`, legacy summaries (`IMPLEMENTATION_SUMMARY.md`, `PHASE1_IMPLEMENTATION_SUMMARY.md`, `OWNERSHIP_IMPLEMENTATION.md`, `COMMIT_SUMMARY_TEMPLATE_FIX.md`, `MIGRATION_v0.7_THEME_AWARE_SCHEMA.md`, `TEMPLATE_ID_RULE.md`, `FINAL_VERIFICATION_CHECKLIST.md`, `BUILD_LOG_*.md`) — read+edit
- `docs/engineering/agent-system/**` — read (owned by Orchestrator; edits proposed, not made)

## Excluded files & domains
- `src/**`, `supabase/**`, `scripts/**`, config files — read only the minimum needed to verify a specific documentation claim; never edit (owners: other specialists)
- `docs/engineering/engineering-playbook.md` normative content — changes are `Tom approves` via version bump or ADR
- `build-log-V*.txt` authoring — owned by release-engineering

## Architectural invariants
| Invariant | Source |
|---|---|
| One authoritative document per concern; before writing a "current state" doc, check whether one owns the concern | Playbook §9 |
| ADRs never edited in place; superseded by new ADRs; Proposed → Review → Accepted (Tom) lifecycle | Playbook §9 |
| Audits are dated snapshots, marked "superseded by backlog" once absorbed | Playbook §9 |
| No new standalone `*_IMPLEMENTATION_SUMMARY.md` — build log + ADR instead | Playbook §9 |
| Authoritative set: Playbook (principles/agents) · `architecture-decisions.md` (ADRs) · `config-architecture.md` (config/DS register) · `release-workflow.md`+`release-automation.md` (release) | Playbook §9 table |
| Staleness is a tracked defect | Playbook §9 |

## Applicable ADRs
- ADR-007 — every commit deployable (affects how doc changes are batched)
- The full ADR log is a work object (numbering, casing, supersession), not context to be memorized

## Relevant workflows (Playbook §5)
- §5.1 step 7 — one-line doc note when editor capability changes
- §9 freshness drift check (periodic)

## Mandatory quality gates
- None of gates 1–7 apply to prose; substitute checks: every asserted code fact verified against files (P0); no broken internal links in changed docs.

## Known risks (P0-labelled)
- **Verified fact:** `CLAUDE.md` claims "46 tests" (Testing section); Playbook §10 records actual 194 with 2 flaky (I8/I9).
- **Verified fact:** `CLAUDE.md` nowhere references the Engineering Playbook or its own demotion to implementation handbook (grep 2026-07-10).
- **Verified fact:** no engineering documentation index exists (`grep -ri "documentation index" docs/ *.md` → no hits, 2026-07-10).
- **Verified fact:** ADR-012 is referenced but missing; ADR-007 appears after ADR-008 in `architecture-decisions.md` (file inspection).
- **Verified fact (Playbook I8):** `ABLUO.md` contradicts ADR-001; duplicated current-state docs across three locations (repo `docs/`, root, `/Users/tmz/Abluo/Abluo/`).

## Active backlog initiatives (Playbook §7)
- **I8 — Documentation Consolidation** (Short/S): correct `CLAUDE.md` stale facts; mark `ABLUO.md` + duplicated audits superseded; write or unreference ADR-012.

## Escalation conditions (beyond spine §10)
- A doc correction requires deciding which of two conflicting sources is right (`AI recommends` at most)
- Any change touching Playbook normative text
- Discovery that an external doc location (`/Users/tmz/Abluo/Abluo/`) is load-bearing

## Update & invalidation triggers
- I8 items landing → regenerate; Playbook version bump → regenerate; any ADR accepted → refresh ADR facts; new authoritative doc created → update authoritative-set table.
