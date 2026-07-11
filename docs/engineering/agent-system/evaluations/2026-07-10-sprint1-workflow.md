# Workflow Evaluation — Sprint 1: Analytics & Site Verification Infrastructure · 2026-07-10

**Governing Playbook sections:** §3.6 (chain with reviewers), §5.6 (implement a feature), §2 (gates) · **Format:** `../maturity-evaluation.md` v1.1 (workflow record)
**Participants:** orchestrator → sanity-content-contracts → frontend-sections → documentation → release-engineering
**Per-specialist records:** `2026-07-10-sprint1-{sanity-content-contracts,frontend-sections,documentation,release-engineering}.md`

## What was built

Per-tenant, platform-managed tracking/verification config: `siteConfig.integrations` (GA4, GTM, Google/Bing verification, Meta Pixel, customScripts) → GROQ projections → types → `TrackingScripts.tsx` (production-only, both layout branches) → `Metadata.verification` (all environments) → ADR-013 (Proposed) + config register + handbook note → gates + `build-log-V1.0.14.txt` + proposed commit for Tom. First real feature executed through the Engineering OS.

## Workflow findings

1. **Sequencing worked:** strict schema→consumer→docs→release order; zero shared-file conflicts; each specialist received only spine + own pack + task; all four Standard Handoffs accepted on first submission.
2. **The spine's P0 rule produced its first two payoffs:** frontend-sections overrode an orchestrator default (`next/script`) with repo evidence (React 19 fix precedent); release-engineering found the I2 root cause (`next.config.ts` `--match 'v[0-9]*'` ignores capital-V tags).
3. **The spine's P0 rule also caught its first violation:** documentation wrote an unverified tenant claim into ADR-013 as fact. Detected by orchestrator spot-check, not by the agent — supports keeping cheap-tier output supervised while Experimental.
4. **Interim review rule exercised as designed:** Gates 5 (a11y) and 6 (security — customScripts injection) escalated as `Tom approves`, never self-certified.
5. **Sandbox limitation (recurring):** Gate 3 (`rm -rf .next && next build`) is permission-blocked in the session sandbox. Until CI (I9) exists, deterministic builds require Tom's local run — every sprint will hit this.
6. **Artifact conflict (reported, not silently resolved — spine §1):** `orchestrator.md` grants the orchestrator no edit tools, but agent-system README step 5 requires the orchestrator to write evaluation records. This session wrote the records (README mandate; "no edit tools" reads as "no *implementation*"), but the two artifacts should be reconciled — small documentation task, `Tom approves`.

## Open items leaving this workflow (for Tom, by level)

| Item | Level |
|---|---|
| Run `rm -rf .next && npx next build` locally (Gate 3) | Tom action |
| Gate 5 accessibility review (minimal surface: noscript iframe/img) | Tom approves |
| Gate 6 security review — customScripts arbitrary-JS injection | Tom approves |
| ADR-013 acceptance (+ delete the unverified "Livener uses GTM" line) | Tom approves |
| Version V1.0.14 + proposed commit in `build-log-V1.0.14.txt`, push to dev, then STOP | Tom approves |
| I2 tag-case convention (now with root-cause evidence) | Tom decides |
| Reconcile orchestrator.md tools vs README step 5 | Tom approves |

**Verdict:** the Engineering OS completed its first feature sprint with zero rejected handoffs, one caught P0 defect, and two evidence discoveries beyond brief. All four specialists: continue Experimental.
**Evaluator:** Orchestrator (this session), pending Tom review.
