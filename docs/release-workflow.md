# Release Workflow — Operations Runbook

**What to do during a release.** Follow this top to bottom. You don't need to know
how the tooling works to use it — for that, see
[`release-automation.md`](./release-automation.md).

Two rules that override everything else:

1. **Releases flow in one direction:** `localhost → dev → preview → production`.
   Never skip a stage.
2. **Every `STOP` is literal.** Do not continue past a `STOP` until the named
   verification has passed. Skipping a hold point is what caused the V0.8.2
   production outage.

**One version only — the Platform Version**, a lowercase git tag like `v1.0.2`,
created by `./scripts/release.sh`. There is no engineering version; a build is
identified by its commit, branch, environment, and build time. The current
baseline is `v1.0.1`; the next release is `v1.0.2`.

---

## 1. Daily development (localhost → dev)

Normal work — not every commit is a release.

```bash
npm run dev                 # http://localhost:3000
npx tsc --noEmit && npx vitest run
git add <files>
git commit -m "feat: ..."   # ordinary feature commits
git push origin dev
```

Verify your change on **https://dev.abluo.app**. Cut a release only when you want
to ship a versioned release through to production.

---

## 2. Cut a release (on `dev`)

```bash
git checkout dev
./scripts/release.sh v1.0.2 "Location Platform"   # title optional
```

The script validates the version, runs health checks and a clean build, creates
the release-marker commit `release: v1.0.2 - Location Platform`, tags `v1.0.2`,
and pushes `dev` + the tag. Then:

```text
Verify the dev deployment — open https://dev.abluo.app
```

> ### STOP
> Do not promote until the release is confirmed working on `https://dev.abluo.app`.

---

## 3. Preview release (dev → preview)

```bash
git checkout preview
git merge --ff-only dev
git push origin preview
git checkout dev            # always return to dev
```

```text
Verify the preview deployment — open https://preview.abluo.app
Vercel will show the deployment as: "release: v1.0.2 - Location Platform"
```

> ### STOP
> **Customer approval required** before promoting to production.

---

## 4. Production release (preview → main)

```bash
git checkout main
git merge --ff-only preview
git push origin main
git checkout dev            # always return to dev
```

```text
Verify production:
□ https://abluo.app loads and the change is live
□ https://abluo.app/api/version shows platformVersion v1.0.2
□ Version badge (Studio, bottom-left) shows v1.0.2 + the commit
□ Vercel production deployment reads "release: v1.0.2 - Location Platform"
```

> ### STOP
> Confirm production is healthy before doing anything else. If anything looks
> wrong, go to **Rollback** (section 6).

All promotions are `--ff-only` fast-forwards. If a fast-forward is ever rejected,
**STOP** — that signals branch divergence; do not force it.

---

## 5. Hotfix workflow (urgent production fix)

A hotfix is still a release — fast-tracked, not skipped.

```bash
git checkout dev
git pull --ff-only origin dev
# make the minimal fix, then:
npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix: <what was fixed>"
./scripts/release.sh v1.0.3 "Hotfix: <summary>"   # bump the patch version
```

Then run sections 3 and 4 (Preview, Production) including both `STOP`s. A hotfix
gets priority but still travels through preview and production verification.

---

## 6. Rollback

Roll back the deployment first (fastest), then the code.

### Deployment rollback (fastest — restores users immediately)
In the Vercel dashboard for the affected project, promote / roll back to the
previous good deployment. Restores the live site in seconds without touching git.

### Git rollback
```bash
git tag --sort=-creatordate | head -5     # find the last good version tag

# Preferred — revert the bad release commit (preserves history)
git checkout main
git revert <bad-commit-sha> --no-edit
git push origin main

# then bring dev back in line
git checkout dev && git merge main --no-edit && git push origin dev
```

### Rollback verification
```text
□ https://abluo.app loads and the bad change is gone
□ https://abluo.app/api/version shows the expected platformVersion + commit
□ Version badge shows the expected version
□ git log on main reflects the rollback
□ dev is back in sync with main
□ Team notified
```

---

## 7. Emergency checklist (production down or broken)

```text
□ Reproduce the problem at https://abluo.app
□ Check https://abluo.app/api/version — note the live commit + version
□ Roll back the Vercel deployment to the last good one (restores users fast)
□ Confirm the site is healthy again
□ Capture what happened (screenshot, error, bad commit sha)
□ Fix forward via the Hotfix workflow (section 5) — do not skip STOPs
□ Note the incident + cause in CHANGELOG.md
```

If unsure whether to roll back: **roll back.** A working old version beats a
broken new one.

---

## 8. Release verification checklist

Complete before considering any release finished.

```text
□ Local build         npm run build passed (the release gate enforces this)
□ Tests               npx tsc --noEmit + npx vitest run passed
□ Dev deployment      verified on https://dev.abluo.app
□ Preview deployment  verified on https://preview.abluo.app (+ customer approval)
□ Production          verified on https://abluo.app
□ Version badge       shows the correct platform version + commit
□ /api/version        platformVersion / commit / branch / built correct
□ Git tag             the new lowercase tag exists locally and on origin
□ release.json        version matches the tag (generated — never hand-edited)
□ package.json        version matches the tag (without the leading v)
□ Smoke test          core flows work (load a tenant site, open the dashboard)
```

---

## Command quick reference

| Goal | Command |
|---|---|
| Health check only | `./scripts/doctor.sh` |
| Cut a release | `./scripts/release.sh v1.0.2 "Title"` |
| Preview a release (no changes) | `./scripts/release.sh v1.0.2 --dry-run` |
| Promote dev → preview | `git checkout preview && git merge --ff-only dev && git push origin preview` |
| Promote preview → production | `git checkout main && git merge --ff-only preview && git push origin main` |
