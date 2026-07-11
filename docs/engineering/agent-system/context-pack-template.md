# Context Pack Template

**Version:** 1.0 · **Status:** Active
**Governing Playbook section:** §4 · **Spec:** `context-pack-spec.md`
**Purpose:** Copy this file to `packs/<domain>.pack.md` and fill every section. Delete nothing; write "None" where empty.
**Owner:** Orchestrator · **Consumers:** pack authors
**Update conditions:** changes to `context-pack-spec.md`.

---

```markdown
# Context Pack — <Domain Name>

| | |
|---|---|
| **Pack version** | 1.0 |
| **Maturity / status** | Experimental / Active |
| **Owner** | <specialist agent> (supervised by Orchestrator while Experimental) |
| **Consumers** | <agents that load this pack> |
| **Reflects** | Playbook v1.0 · branch `dev` @ `<commit>` |
| **Sources** | Playbook §<…> · ADR-<…> · CLAUDE.md §<…> · <repo evidence> |

Inherits the Shared Context Spine (`../context-spine.md`). Additive only; never contradicts spine or accepted ADRs.

## Domain purpose
<one paragraph>

## Owned files & directories
- `<path>` — <read | read+edit>

## Excluded files & domains
- `<path or domain>` — owned by <agent>; hand off, never touch

## Architectural invariants
| Invariant | Source |
|---|---|
| <rule> | Playbook §<…> / ADR-<…> / CLAUDE.md |

## Applicable ADRs
- ADR-NNN — <title>

## Relevant workflows (Playbook §5)
- §5.x — <workflow>

## Mandatory quality gates
- Gate <n> — <name> — <when it applies>

## Known risks (P0-labelled)
- **Verified fact:** <defect/debt + file reference>
- **Assumption:** <…>

## Active backlog initiatives (Playbook §7)
- I<n> — <relevance to this domain>

## Escalation conditions (beyond spine §10)
- <domain-specific trigger>

## Update & invalidation triggers
- <event> → regenerate pack, bump version
```
