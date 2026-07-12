# Abluo Agent System — Phase 3A Foundation

**Version:** 1.0 · **Status:** Active (pilot phase)
**Governing Playbook sections:** §12 (Phase 3 implements the Playbook), §3 (AI Engineering Strategy), §4 (Context Packs), I10
**Purpose:** Index and operating guide for the engineering-agent infrastructure. Implements the Playbook; introduces no policy of its own (Playbook "Next Phase": new policy enters the Playbook first).
**Owner:** Orchestrator (Tom-supervised) · **Consumers:** Tom, all agents, future sessions
**Update conditions:** any agent/pack added, promoted, merged, or retired; Playbook version bump.

---

## Structure

| Artifact | Location | Playbook source |
|---|---|---|
| Agent definitions | `.claude/agents/*.md` (project convention — invocable as subagents) | §3.2, §3.3, §3.5 |
| Shared Context Spine | `context-spine.md` | §4 |
| Context Pack spec / template | `context-pack-spec.md` / `context-pack-template.md` | §4 |
| Context Packs | `packs/*.pack.md` | §4 |
| Standard Handoff | `handoff-format.md` | §3.5–3.6 |
| Maturity & evaluation | `maturity-evaluation.md`, `evaluations/` | §3.4 |

## Roster (Phase 3A)

| Agent | Maturity | Model tier | Pack |
|---|---|---|---|
| `orchestrator` | governing role | strong | owns spine |
| `documentation` | **Experimental** | cheap | `packs/documentation.pack.md` |
| `sanity-content-contracts` | **Experimental** | mid | `packs/sanity-content-contracts.pack.md` |
| `frontend-sections` | **Experimental** | cheap | `packs/frontend-sections.pack.md` |
| `release-engineering` | **Experimental** | mid | `packs/release-engineering.pack.md` |

No agent may be labelled Stable or Core in this phase.

## How a task flows

1. Tom (or a session acting for Tom) gives the task to the **orchestrator**.
2. Orchestrator: classify decisions (§3.8) → ADR needed? → identify domains → load spine + relevant packs only → pick cheapest capable specialist → dependency & shared-file analysis: sequence dependent or file-overlapping work; fan out independent, non-overlapping work concurrently and synthesize after all handoffs return. Routine operational work (smoke tests, deployment verification, version checks) is owned by release-engineering and is delegated, not self-executed. Authoritative rules: `.claude/agents/orchestrator.md` — *Delegation ownership*, *Fan-out / fan-in*, *Delegation fallback*.
3. Specialist: universal behaviour (spine §6) → work → gates → **Standard Handoff**.
4. Orchestrator: accept/reject handoff → route reviews (UI→Accessibility, API/DB/auth→Security — both currently `Tom approves` escalations, see below) → verify gates → synthesize one result for Tom.
5. Orchestrator writes evaluation records (`evaluations/`): one per participating specialist, plus a workflow record when a task involved multiple agents or review stages. The Orchestrator evaluates the engineering workflow, not only individual specialists (`maturity-evaluation.md` v1.2).

## Notifications (2026-07-12)

**When to notify is owned by the orchestrator** (`.claude/agents/orchestrator.md` — *Notifications*): workflow completion, blocked-on-Tom, or long-run finish — never per-handoff. **Phase-end commit readiness is owned by release-engineering** (`packs/release-engineering.pack.md` v1.1) and must precede any commit guidance to Tom.

Mechanisms (verified against official Claude Code docs, 2026-07-12):

- **Repo hooks** — `.claude/settings.json` configures `Notification`-event hooks (`idle_prompt`, `agent_needs_input`, `agent_completed`) running a guarded `osascript` macOS notification (no-op on non-macOS). Fire in Claude Code CLI and the desktop app's Claude Code surface; **do NOT fire in Cowork sessions** — there, the orchestrator's boundary user-message is the notification. The `Stop` hook fires on every response end and is deliberately not used (noise rule).
- **Mobile push** — "Push when Claude decides" via `/config` inside Claude Code (requires the Claude mobile app on the same account + Remote Control; account/device-level — cannot be enabled from this repository). One-time macOS grant for the hook path: run the osascript command once, then System Settings → Notifications → Script Editor → Allow Notifications.
- **Dispatch** — background-agent sessions emit `agent_needs_input`/`agent_completed` Notification events automatically; there is no standalone "send via Dispatch" command.

No hook may contain credentials, account tokens, or device identifiers; machine-local preferences belong in `~/.claude/settings.json` or `.claude/settings.local.json`, never in the shared repo file.

## Interim review rule

Accessibility, Security (Supabase), and Testing & Review specialists **do not exist yet**. Until they do, their mandatory reviews (Playbook §2 Review stage) are explicit `Tom approves` escalations in the handoff. Skipping them is a gate violation.

## Subsequent specialist candidates (not created in 3A — Playbook §3.3 roster)

Supabase & Security · Accessibility · Testing & Review · Localization · Design System · Architecture Review. Create each only when the three §3.3 conditions hold (stable boundary + recurring work + owned invariants) — validated by pilot experience, not assumed.

## Known platform-tooling caveats (Verified facts, 2026-07-10)

- Claude Code subagents cannot themselves spawn subagents. When the orchestrator runs *as a subagent*, delegation happens by returning a routing plan for the main session to execute; when the main session itself follows `orchestrator.md`, it delegates directly. The definition file is canonical either way.
- Agents created mid-session are not hot-loaded; new definitions are available from the next session.
