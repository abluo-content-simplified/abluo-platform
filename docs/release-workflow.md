# Release Workflow — Operations Runbook

**What to do during a release.** Follow this top to bottom. You do not need to
understand how the tooling works to use it — for that, see
[`release-automation.md`](./release-automation.md).

Two rules that override everything else:

1. **Releases flow in one direction:** `localhost → dev → preview → production`.
   Never skip a stage.
2. **Every `STOP` in this document is literal.** Do not continue past a `STOP`
   until the named verification has passed. Skipping a hold point is what caused
   the V0.8.2 production outage.

Versions you will see (full model in `release-automation.md`):

- **Platform version** — customer-facing, e.g. `V1.0.0`. Cut with `milestone.sh`.
- **Engineering version** — developer-facing iteration within the current
  platform milestone, e.g. `V1.0.0.1`, `V1.0.0.2`. Cut with `release.sh eng`.

Quick orientation at any time:

```bash
./scripts/release.sh status    # branch, last release, what's next, drift
./scripts/release.sh next      # the exact next release command
```

---

## 1. Daily development (localhost → dev)

```bash
# 1. Work on localhost
npm run dev                     # http://localhost:3000

# 2. Test locally
npx tsc --noEmit
npx vitest run

# 3. Stage what you want to release
git add <files>

# 4. Engineering release (version comes from release.json automatically)
./scripts/release.sh eng "Short description of the change"
```

`release.sh eng` runs health checks, builds, commits, tags the engineering
version, pushes `dev` and the tag, and verifies the result. It prints the
structured summary when done.

```text
# 5. Verify the dev deployment
Open https://dev.abluo.app and confirm the change is live and correct.
```

> ### STOP
> **Never continue before verifying `dev`.** Do not promote to preview until the
> change is confirmed working on `https://dev.abluo.app`.

---

## 2. Preview release (dev → preview)

Preview is the stage where the client/tenant reviews the work.

```bash
git checkout preview
git merge dev --no-edit
git push origin preview
git checkout dev                # always return to dev afterwards
```

```text
# Verify the preview deployment
Open https://preview.abluo.app and confirm the change.
```

> ### STOP
> **Customer approval required.** Do not promote to production until the client
> has reviewed and approved the change on `https://preview.abluo.app`.

---

## 3. Production release (preview → main)

```bash
git checkout main
git merge preview --no-edit
git push origin main
git checkout dev                # always return to dev afterwards
```

```text
# Verify production
Open https://abluo.app and confirm the change is live.
```

> ### STOP
> Confirm production is healthy before doing anything else.

### If this is a platform milestone

A milestone is a customer-facing product version (`X.Y.0`, e.g. `V1.1.0`). Tag it
only **after** production is verified and serving the milestone commit.

```bash
git checkout main
./scripts/milestone.sh V1.1.0 -m "Milestone name"
```

`milestone.sh` verifies you are on `main`, the tree is clean, there are no
unpushed commits, and **production is already serving this commit** (via
`/api/version`). It then tags the milestone, updates `release.json`
(`platformVersion`, and resets the engineering base to this milestone) and syncs
`package.json`.

After it runs:

```text
□ Commit the release.json / package.json changes on main, then merge main → dev
□ Verify the version badge (Studio, bottom-left) shows: Platform V1.1.0
□ Verify https://abluo.app/api/version shows platformVersion V1.1.0
□ Add a V1.1.0 entry to CHANGELOG.md (human-readable milestone history)
```

The next engineering release after a milestone is `V1.1.0.1` — a new engineering
cycle begins automatically.

---

## 4. Hotfix workflow (urgent production fix)

Use this only for urgent fixes that cannot wait for the normal flow. The fix
still travels through every environment — it is fast-tracked, not skipped.

```bash
# 1. Branch from the production code
git checkout main
git pull --ff-only origin main
git checkout -b hotfix/<short-name>

# 2. Make the minimal fix, then verify locally
npx tsc --noEmit && npx vitest run && npm run build

# 3. Merge the fix back into dev and release it as an engineering iteration
git checkout dev
git merge hotfix/<short-name> --no-edit
git add -A
./scripts/release.sh eng "Hotfix: <what was fixed>"
```

Then run the normal **Preview** and **Production** stages above — including both
`STOP`s. Verify on `dev`, then `preview`, then `main`. Delete the hotfix branch
once it has landed on `main`:

```bash
git branch -d hotfix/<short-name>
```

> A hotfix is still a release. It does not bypass preview or production
> verification — it only gets priority.

---

## 5. Rollback

If a release is bad, roll back the deployment first (fastest), then the code.

### Deployment rollback (fastest — restores users immediately)

In the Vercel dashboard for the affected project, find the previous good
deployment and **Promote / Roll back to** it. This restores the live site within
seconds without touching git.

### Git rollback (restores the source of truth)

```bash
# Identify the last good tag
git tag --sort=-creatordate | head -5

# Option A — revert the bad commit (preferred; preserves history)
git checkout main
git revert <bad-commit-sha> --no-edit
git push origin main

# Option B — point the branch back to the last good commit (only if nothing
# good has landed since; rewrites history — coordinate with the team first)
git checkout main
git reset --hard <last-good-sha>
git push --force-with-lease origin main
```

After a git rollback, bring `dev` back in line so the next release is clean:

```bash
git checkout dev
git merge main --no-edit
git push origin dev
```

### Rollback verification checklist

```text
□ https://abluo.app loads and the bad change is gone
□ https://abluo.app/api/version shows the expected commit
□ Version badge shows the expected Platform / Engineering versions
□ git log on main reflects the rollback
□ dev is back in sync with main
□ Team notified
```

---

## 6. Emergency checklist (production is down or broken)

Work calmly, top to bottom. Restore first, diagnose later.

```text
□ Confirm the problem — open https://abluo.app and reproduce it
□ Check https://abluo.app/api/version — note the live commit + versions
□ Roll back the Vercel deployment to the last good one (restores users fast)
□ Confirm the site is healthy again
□ Capture what happened (screenshot, error, the bad commit sha)
□ Fix forward via the Hotfix workflow (section 4) — do not skip STOPs
□ Once fixed and verified on production, tag/milestone if appropriate
□ Note the incident + cause in CHANGELOG.md or an incident note
```

If unsure whether to roll back: **roll back.** A working old version beats a
broken new one.

---

## 7. Release verification checklist

Complete this before considering **any** release finished. (For milestones, also
do the milestone checklist in section 3.)

```text
□ Local build         npm run build passed
□ Tests               npx tsc --noEmit + npx vitest run passed
□ Dev deployment      verified on https://dev.abluo.app
□ Preview deployment  verified on https://preview.abluo.app (+ customer approval)
□ Production deployment verified on https://abluo.app
□ Version badge       shows correct Platform + Engineering versions
□ /api/version        platformVersion / engineeringVersion / commit correct
□ Git tags            the new tag exists locally and on origin
□ release.json        platformVersion + engineeringVersion correct
□ package.json        version matches the platform version
□ Smoke test          core flows work (load a tenant site, open the dashboard)
```

---

## Command quick reference

| Goal | Command |
|---|---|
| See what to release next | `./scripts/release.sh next` |
| See current state / drift | `./scripts/release.sh status` |
| Health check only | `./scripts/doctor.sh` |
| Engineering release (dev) | `./scripts/release.sh eng "message"` |
| Preview a release, no changes | `./scripts/release.sh eng --dry-run` |
| Platform milestone | `./scripts/milestone.sh V1.1.0 -m "name"` |

Promotion (`dev → preview → main`) is manual today and is automated in Release
Automation 1.3 (`promote.sh`).
