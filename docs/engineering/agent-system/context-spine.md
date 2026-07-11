# Abluo Shared Context Spine

**Version:** 1.0 · **Status:** Active
**Governing Playbook sections:** §4 (Context Packs — "shared spine"), §1 (P0–P7), §2 (gates), §3.4–3.8
**Purpose:** The minimum ruleset every agent must hold. Inherited by every Context Pack.
**Owner:** Orchestrator · **Consumers:** all agents
**Update conditions:** Playbook version bump, accepted ADR touching a spine rule, gate/decision-level change. Spine changes invalidate all packs.

---

## 1. Authority order

1. `docs/engineering/engineering-playbook.md` (v1.0 — highest engineering authority)
2. Accepted ADRs that explicitly supersede a specific Playbook rule
3. `CLAUDE.md` (implementation handbook — *how*, within the Playbook's *why/what*)
4. Domain documentation (`docs/**`)
5. Historical audits and implementation notes

If sources conflict: **report the conflict; never silently choose.**

## 2. Evidence First (P0)

Label every claim **Verified fact** (checked against code/test/live state), **Assumption** (stated as such), or **Hypothesis**. Verify before asserting. A terse finding with a file reference beats a confident narrative.

## 3. Platform principles (P1–P7, compressed)

- **P1** Invariants are enforced by gates/tests, not remembered.
- **P2** No tenant names in platform code — tenant behavior lives in data. Never add `if (tenant === …)`.
- **P3** Schema → GROQ → Types is a typed contract; drift is a defect.
- **P4** Carry minimum context, from durable packs — never from memory of past sessions.
- **P5** Accessible and secure by default.
- **P6** Every commit is deployable (ADR-007).
- **P7** Evolve, don't rewrite, what works.

## 4. Decision ownership (Playbook §3.8)

| Level | Meaning |
|---|---|
| **AI decides** | Bounded in-domain work; gate-passing changes; evidence gathering |
| **AI recommends** | Options + evidence presented; Tom chooses |
| **Tom approves** | AI proposes; Tom signs off before it lands (ADR acceptance, release cut, STOP gates, Core promotion) |
| **Tom decides** | Tom originates (security tradeoffs, production promotion, version convention, any irreversible action) |

Ambiguity resolves **toward** Tom, never away.

## 5. Agent maturity (Playbook §3.4)

Experimental → Stable → Core. **Every current agent is Experimental**: supervised, outputs reviewed, may be merged or retired quickly. No agent promotes itself; Core promotion is `Tom approves`.

## 6. Universal behaviour (Playbook §3.5)

1. Load only: task + this spine + your Context Pack.
2. Restate scope — what is and isn't in bounds.
3. Identify your owned invariants.
4. Gather evidence before asserting (P0).
5. Refuse out-of-boundary work — hand back to the Orchestrator; never reach into another domain's files.
6. Escalate architectural uncertainty; never resolve `Tom approves`/`Tom decides` items locally.
7. Run the gates relevant to your change.
8. Return the Standard Handoff (`handoff-format.md`) — not just a diff.

## 7. Irreversible actions

Deleting or migrating published content, dropping tables, force-pushes, rewriting tags, bulk mutations of Sanity/Supabase: **all `Tom decides`.** Propose; never execute.

## 8. Deployment STOP gates

`dev` → **STOP (Tom verifies dev.abluo.app)** → `preview` → **STOP (Tom verifies preview.abluo.app)** → `main`. Stops are literal. Agents never push, merge between stage branches, tag, or deploy without explicit approval. Git push happens from Tom's local terminal only.

## 9. Mandatory quality gates (Playbook §2)

1 Type (`tsc --noEmit`) · 2 Test (`vitest run`) · 3 Build (`next build`) · 4 Contract-parity · 5 Accessibility · 6 Security · 7 Version-integrity.
**A red gate stops the pipeline.** No stage advances on red.

## 10. Escalation

Escalate when: scope is exceeded · evidence contradicts documentation · two authoritative sources conflict · a decision is above `AI decides` · a gate is red and the fix is out of scope. Escalation is a success condition, not a failure.

## 11. Response format

Every specialist response ends with the Standard Handoff (`docs/engineering/agent-system/handoff-format.md`). The Orchestrator rejects incomplete handoffs.
