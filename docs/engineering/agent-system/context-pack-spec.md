# Context Pack Specification

**Version:** 1.0 · **Status:** Active
**Governing Playbook sections:** §4 (Context Packs), §9 (docs are the generation source), §3.4 (Core pack changes are gated)
**Purpose:** The standard structure every domain Context Pack must follow.
**Owner:** Orchestrator · **Consumers:** all specialists; anyone authoring a pack
**Update conditions:** Playbook §4 changes; a pack audit reveals a structural gap.

---

## What a pack is

A Context Pack gives one specialist the **minimum context required for correctness** in its domain — no more, no less (Playbook §4). It replaces "load the 30 KB `CLAUDE.md`" with "load your slice." Cross-domain leakage is a pack defect.

## Required sections (every pack)

| # | Section | Content |
|---|---|---|
| 1 | **Header** | Pack name · version · maturity/status · owner · consumers · sources |
| 2 | **Domain purpose** | One paragraph: what this domain is for |
| 3 | **Owned files & directories** | Explicit paths the agent may read and (if permitted) edit |
| 4 | **Excluded files & domains** | What the agent must NOT receive or touch, and who owns it instead |
| 5 | **Architectural invariants** | The rules this agent guards, each traced to Playbook / ADR / `CLAUDE.md` |
| 6 | **Applicable ADRs** | Accepted ADRs governing the domain, by number and title |
| 7 | **Relevant workflows** | Playbook §5 runbooks this domain executes |
| 8 | **Mandatory quality gates** | Which of the seven gates apply to this domain's changes |
| 9 | **Known risks** | Verified current defects/debt inside the domain (labelled per P0) |
| 10 | **Active backlog initiatives** | Playbook §7 items touching this domain |
| 11 | **Escalation conditions** | Domain-specific triggers beyond the spine's general rules |
| 12 | **Update & invalidation triggers** | What events make this pack stale |

## Inheritance

Every pack **inherits the Shared Context Spine** (`context-spine.md`) implicitly. Pack content is additive: a pack may narrow or specialize a spine rule, but may **never contradict the spine or an accepted ADR**. A specialist loads exactly: task + spine + its one pack.

## Ownership

Each pack is owned by its specialist domain; the Orchestrator owns the spine and this spec. The pack owner (the specialist, supervised while Experimental) proposes updates; the Orchestrator reviews. Changes to a **Core** agent's pack are themselves gated (`Tom approves`) per Playbook §3.4.

## Versioning

Packs carry `Version: MAJOR.MINOR` plus the **Playbook version** and **platform state** (branch + commit) they reflect. Bump MINOR for additive updates, MAJOR when an invariant changes. An agent must check its pack's version block before trusting it.

## Update rules & staleness

A pack is **invalidated** by any change to its authoritative sources: an accepted ADR touching the domain · a schema/contract change in owned files · a completed backlog initiative listed in the pack · a new invariant · a spine change. **An invalidated pack must be regenerated before its agent is trusted again** (Playbook §4). Update the source of truth first, then the pack — never edit a pack to disagree with its sources. Packs are currently hand-derived from authoritative docs; generation tooling is a Phase 3B+ candidate.

A pack is presumed **stale** if its recorded commit is more than one release behind `dev` HEAD, or any listed initiative has changed status.

## Orchestrator pack selection

1. Identify affected domain(s) from the task's file paths and subject matter.
2. Load spine + only the packs for affected domains.
3. If two domains are affected, split the task and sequence the specialists (no shared-file concurrency); each gets only its own pack.
4. If no pack covers the domain, escalate — do not improvise a pack inline.

## Exclusion discipline

Examples (Playbook §4): Frontend never receives Supabase migrations or RLS context. Release never receives Sanity schema details. Documentation receives implementation detail only when required to verify a claim. Section 4 of each pack makes exclusions explicit so leakage is auditable.

## Size target

Domain pack: a few KB. If a pack approaches the size of `CLAUDE.md`, the boundary is wrong or the pack carries unrelated context (Playbook §4).
