# Context Pack — Release Engineering

| | |
|---|---|
| **Pack version** | 1.1 — adds Phase-end repository cleanup & handoff readiness (2026-07-12, Tom-directed) |
| **Maturity / status** | Experimental / Active |
| **Owner** | release-engineering agent (supervised while Experimental) |
| **Consumers** | release-engineering agent; Orchestrator |
| **Reflects** | Playbook v1.0 · branch `dev` @ `b78dccc` |
| **Sources** | Playbook §3.3, §5.8, §2 (Release/Deploy/Post-deploy), I2 · CLAUDE.md (Deployment Workflow, Versioning) · `docs/release-workflow.md`, `docs/release-automation.md` · repo inspection 2026-07-10 |

Inherits the Shared Context Spine (`../context-spine.md`). Additive only; never contradicts spine or accepted ADRs.

## Domain purpose
Own versioning, tags, release/health scripts, build logs, deploy sequencing discipline, and post-deploy truth-checking.

## Owned files & directories
- `scripts/release.sh`, `scripts/doctor.sh`, `scripts/lib/*` — read+edit
- `release.json` — read+edit
- `next.config.ts` — read+edit **version wiring only**
- `build-log-V*.txt`, `CHANGELOG.md` — read+edit (never overwrite an existing log)
- `docs/release-workflow.md`, `docs/release-automation.md` — read+edit

## Excluded files & domains
- All of `src/**` except version wiring in `next.config.ts` — other specialists
- Sanity schema, GROQ, Studio — sanity-content-contracts (explicit Playbook §4 exclusion: Release never receives Sanity schema details)
- `supabase/**` — future Supabase & Security agent
- Vercel dashboard settings — outside the repo; report, don't assume

## Architectural invariants
| Invariant | Source |
|---|---|
| Three-stage flow with literal STOPs: dev → **STOP (Tom verifies dev.abluo.app)** → preview → **STOP (Tom verifies preview.abluo.app)** → main + tag | CLAUDE.md Deployment Workflow · Playbook §2, §5.8 |
| Gate 7 Version-integrity: one tag format; HEAD tag == pipeline version == `package.json` | Playbook §2 gate 7 |
| Pre-release: `tsc --noEmit` clean · `vitest run` green · `npm run build` clean (deterministic: `rm -rf .next` first) | CLAUDE.md pre-commit checklist · Playbook §5.8 |
| Release sequence: doctor + build + suite → gate 7 → tag + sync `release.json`/`package.json` → dev push → STOPs → post-deploy truth-check (`/api/version` == tag) | Playbook §5.8 |
| Build logs: `build-log-V{version}.txt`, capital V, one per release, never overwrite; check `git log` for the real last version before numbering | CLAUDE.md Versioning · build-log convention |
| `--no-edit` on all merges; if `git stash` fails, stop and diagnose (V0.8.2 incident) | CLAUDE.md What Caused V0.8.2 |
| Git push from Tom's local terminal only — sandbox cannot authenticate to GitHub | CLAUDE.md Versioning |
| Every release has a known rollback target | Playbook §1 values |

## Applicable ADRs
- ADR-007 — every phase/commit leaves the project deployable

## Relevant workflows (Playbook §5)
- §5.8 Prepare a release (primary)
- §2 Release / Deploy / Post-deploy stages

## Mandatory quality gates
- Gates 1–3 before declaring release-ready; Gate 7 on every release action; post-deploy truth-check (AUTO+AGENT per §2)

## Known risks (P0-labelled)
- **Verified fact:** version split-brain — Playbook I2 records HEAD `V1.0.13` vs pipeline `v1.0.2`; confirmed 2026-07-10: `package.json` = `1.0.2`, `release.json` = `v1.0.2`, mixed-case tags exist (`V*` and `v*` both present in `git tag`).
- **Verified fact:** tag convention conflict — CLAUDE.md prescribes capital `V`, tooling/`release.json` uses `v` (Playbook I2). **Resolution is `Tom decides`. Do not pick one.**
- **Verified fact:** V1.0.6–12 untagged (Playbook I2) — rollback targets incomplete.
- **Verified fact:** no CI exists; gates run locally only (Playbook I9).

## Active backlog initiatives (Playbook §7)
- **I2 — Release & Version Integrity** (Critical/S): reconcile split-brain; re-adopt `release.sh`; post-deploy truth-check. Blocked on the tag-convention decision (`Tom decides`).
- **I9 (subset)** — make `vitest run` green (2 flaky timeout tests) so the release gate is real.

## Phase-end repository cleanup & handoff readiness — owned procedure (v1.1)

**Trigger:** BEFORE the orchestrator gives Tom ANY stage/commit guidance (stage, commit, push, merge, tag, deploy). The orchestrator must route the task here first; commit guidance issued without this report is a workflow defect (maturity-evaluation v1.3 criteria). This file is the single owner of the procedure — other documents reference it.

**Report all items as fresh Verified facts (run the commands; never reuse cached output):**

1. Current branch and HEAD SHA (`git branch --show-current`, `git log --oneline -1`).
2. Complete `git status --short --untracked-files=all`.
3. Whether `.git/index.lock` exists.
4. **If the lock exists:** determine whether a genuine git process currently owns it — check file-scoped, e.g. `lsof .git/index.lock`, and inspect any owning PID. **Never delete the lock merely because it exists. Never kill processes found via broad pgrep/pkill patterns.** If (and only if) no live process holds it and its mtime predates the current operation, the lock is stale: recommend — or execute, within existing approval rules (bounded cleanup is executable in-sandbox; on Tom's machine it is issued as the single guarded command) — `test -z "$(lsof .git/index.lock 2>/dev/null)" && rm .git/index.lock || echo "LOCK IN USE — do not remove"`.
5. `next-env.d.ts`: if modified and the diff is solely build-generated churn (path-only changes from a local `next build`), restore with `git checkout -- next-env.d.ts` (bounded, executable) and report; if the diff contains anything else, report and stop.
6. Generated build artefacts (`.next/`, `tsconfig.tsbuildinfo`, `.DS_Store`, etc.) confirmed absent from the intended set.
7. The exact intended changed-file list (from the phase's accepted handoffs).
8. The exact currently staged list (`git diff --name-only --cached`) — expected empty before guidance unless staging was already approved.
9. Explicit confirmation that intended set == actual working-tree set, naming any stray file.
10. Gate 3 local build result where the change class requires it, or an explicit NOT RUN + who must run it before commit.
11. **Exactly ONE safe next command** for Tom — never a chain (orchestrator interaction rule, `orchestrator.md`).

**Sandbox lock prevention (root cause, verified 2026-07-12):** git on the sandbox FUSE mount creates `.git/index.lock` during status/refresh operations but is denied the unlink — every sandbox session can therefore leave a stale lock in Tom's real repository. All sandbox git invocations by any agent MUST use `git --no-optional-locks <cmd>` (or `GIT_OPTIONAL_LOCKS=0`) for read operations, and stale-lock cleanup on Tom's machine uses the guarded command in item 4 above.

## Escalation conditions (beyond spine §10)
- Any action that would push, merge stage branches, tag, or deploy → per-action `Tom approves`, no exceptions
- Version mismatch beyond the documented I2 facts → report before touching
- Request to overwrite or renumber an existing build log → refuse + escalate

## Update & invalidation triggers
- Tag-convention decision made · I2 landing · CI introduced (I9) · release tooling change → regenerate pack, bump version.
