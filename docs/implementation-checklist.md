# Implementation Checklist

**Version:** 1.0  
**Scope:** Standard completion procedure for any Abluo implementation phase.  
**Applies to:** ADR-011, ADR-012, and all future phased implementations.

> This checklist is phase-agnostic. Follow it for every phase of every roadmap.
> It does not replace the phase specification — it enforces the process around it.
> When in doubt about scope, re-read the phase specification, not this checklist.

---

## Before Implementation

- [ ] Prerequisites listed in the phase specification are confirmed complete.
- [ ] Phase scope, acceptance criteria, and rollback strategy have been read in full.
- [ ] The Phase 0 / audit inputs required by this phase are available (if applicable).
- [ ] Working tree is clean: `git status` shows no uncommitted changes.
- [ ] On the correct branch: `git checkout dev`.
- [ ] Branch is up to date: `git pull origin dev`.
- [ ] Last version confirmed: `git log --oneline -5` — note the current version tag before starting.

---

## During Implementation

- [ ] Scope is limited to this phase only. No opportunistic refactoring.
- [ ] No changes to files outside the phase's expected file list without a documented reason.
- [ ] Documentation updated only where the phase specification requires it.
- [ ] If an unexpected complication arises that would require scope expansion: **stop**. Record the finding. Do not expand scope unilaterally — raise a Roadmap Amendment if needed.

---

## Verification

**Automated:**
- [ ] `npx tsc --noEmit` — TypeScript clean, zero errors.
- [ ] `npx vitest run` — all tests pass, no regressions.
- [ ] `npm run build` — build succeeds.

**Manual:**
- [ ] Manual test steps listed in the phase specification are completed.
- [ ] Every acceptance criterion is met and verified. Go through them one by one.
- [ ] Rollback procedure has been re-read after implementation. Confirm it is still accurate (implementation may have changed what a rollback requires).

**If any item above fails:** do not proceed to deployment. Fix the failure or raise a Roadmap Amendment explaining why the phase needs to be revised.

---

## Deployment

**To dev:**
- [ ] `git add <files>` — stage only the files expected by this phase.
- [ ] `git commit -m "V{version}: {description}"` — capital V, version first.
- [ ] `git push origin dev`.
- [ ] **Stop. Wait for Tom to verify on `https://dev.abluo.app`.**
- [ ] Tom confirms dev is working.

**To preview:**
- [ ] `git checkout preview && git merge dev --no-edit && git push origin preview`.
- [ ] **Stop. Wait for Tom to verify on `https://preview.abluo.app`.**
- [ ] Tom confirms preview is working.

**To production:**
- [ ] `git checkout main && git merge preview --no-edit`.
- [ ] Apply version tag if this phase carries one: `git tag V{version}`.
- [ ] `git push origin main --tags`.
- [ ] Verify production on `https://abluo.app` (or the relevant tenant URL).
- [ ] `git checkout dev` — return to dev after every production promotion.

---

## Completion

- [ ] Version tag applied and pushed (if this phase carries a version).
- [ ] Progress tracker updated: mark phase as **Complete**, record completed date, add any notes.
- [ ] If a Roadmap Amendment was required during this phase: amendment is written and recorded before the next phase begins.
- [ ] Next phase prerequisites have been checked — confirm the next phase is unblocked before starting it.

---

## Quick Reference — Status Values (for progress tracker)

| Status | Meaning |
|---|---|
| `Waiting` | Prerequisites not yet met; not started |
| `Ready` | Prerequisites met; can be started |
| `In Progress` | Implementation underway |
| `Verifying` | Implementation complete; in dev/preview verification |
| `Complete` | Verified on production; phase closed |
| `Blocked` | Cannot proceed; reason recorded in Notes |
| `Amended` | Scope changed by a Roadmap Amendment; see amendment record |
