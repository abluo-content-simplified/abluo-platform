# Release Automation

Developer tooling for cutting Abluo releases safely and repeatably.

This is **platform developer tooling**, not part of ADR-011. It exists to replace
the error-prone manual release steps that previously had to be run by hand (and
which caused incidents such as the V0.8.2 production break).

**Release Automation 1.2 automates the `localhost → dev` workflow and platform
milestone tagging.** It derives the engineering version from `release.json` (or
the roadmap), gates on a successful build, commits, tags, pushes to `dev`, and
verifies the result. Promotion (`dev → preview → production`) remains manual
until [Release Automation 1.3](#future-roadmap) (`promote.sh`).

> Release Automation itself is **not** part of ADR-011 (which is complete). It is
> post-milestone engineering tooling, versioned on the engineering axis (see
> [Version model](#version-model)).

---

## Version model

Abluo runs **two independent version axes**. Neither is derived from the other —
the engineering line can sit numerically *below* the platform line.

| Axis | Audience | Example | Advances when | Tagged by |
|---|---|---|---|---|
| **Platform version** | Customers | `V1.0.0` (`X.Y.0`) | A product milestone ships | `milestone.sh` |
| **Engineering version** | Developers | `V1.0.0.1` | Each engineering iteration | `release.sh` |

The engineering version **always belongs to the current platform milestone** —
it is an iteration counter within that milestone, never a continuation of the
previous one. Within a milestone the 4th segment increments
(`V1.0.0.1 → V1.0.0.2 → …`). When a new milestone ships, the engineering base
inherits **that** milestone — e.g. after `V1.1.0`, the next engineering iteration
is `V1.1.0.1` (not `V1.0.0.x`). This keeps engineering from ever looking older
than the platform it belongs to.

`release.json` is the **single machine-readable source of truth** for both axes;
`CHANGELOG.md` is the human-readable history. The version badge, `/api/version`,
`package.json`, and the release scripts all consume `release.json`.

### Engineering version philosophy

Engineering versions are **scoped to the current platform milestone**. They do
**not** represent product maturity, customer releases, or the overall evolution
of the platform. Their sole purpose is to identify engineering iterations that
belong to a specific platform release.

```
Platform              Engineering
V1.0.0                V1.0.0.1
                      V1.0.0.2
                      V1.0.0.3
```

When the next platform milestone is released, a new engineering cycle begins:

```
Platform              Engineering
V1.1.0                V1.1.0.1
                      V1.1.0.2
```

This intentionally keeps the engineering version visually associated with the
platform version it belongs to, and avoids situations where the engineering
version appears numerically older than the deployed platform.

For the current milestone (`V1.0.0`), the engineering line is initialized at
`V1.0.0.1` — i.e. the engineering line is being *initialized* for the current
platform milestone, not continued from a prior one.

### release.json

```json
{
  "platformVersion": "V1.0.0",
  "engineeringVersion": "V1.0.0.1",
  "releaseName": "Release Automation 1.2",
  "releasedAt": "2026-06-27"
}
```

It holds **version identity only** (declarative intent). Build provenance —
commit SHA, branch, environment, build time — stays in build-time env vars
(`next.config.ts` → `/api/version`), because a committed file cannot contain its
own commit SHA. `package.json.version` is auto-synced to the *platform* version
(valid semver, no leading `V`); the 4-segment engineering version never goes
there. Access `release.json` only through the `release_*` / version helpers in
`lib/common.sh` — never grep it elsewhere.

---

## Scripts

```
scripts/
  doctor.sh        # repository health checks + version-consistency checks
  release.sh       # engineering releases (localhost → dev)
  milestone.sh     # platform milestone tagging
  lib/
    common.sh      # shared helpers: colours, logging, git, roadmap, version SSOT
```

All are POSIX-friendly shell scripts using `set -euo pipefail` and sourcing
`lib/common.sh`, so future scripts (`promote.sh`, `verify.sh`) reuse the same
helpers without duplication. `release.json` access uses `node` (already a repo
dependency).

---

## Scope of this document

This document explains **how the tooling works** — the version model, each
script's behaviour, and configuration. For the step-by-step **release procedure**
(what to run, in what order, where the `STOP` points are), follow the operations
runbook: [`release-workflow.md`](./release-workflow.md).

---

## `release.sh`

### Usage

```
./scripts/release.sh <phase|version> [message] [options]
```

| Form | Example | Notes |
|---|---|---|
| **Engineering mode** (default now) | `./scripts/release.sh eng "Release Automation 1.2"` | Version from `release.json`; auto-advances the 4th segment if already tagged |
| **Phase mode** (roadmap-driven) | `./scripts/release.sh A2` | Version + message derived from the roadmap |
| **Explicit-version mode** | `./scripts/release.sh V0.9.20 "ADR-011 A2 ModuleManifest"` | Backward compatible — message required |

Engineering and explicit modes refuse platform-milestone versions (`X.Y.0`) and
redirect you to `milestone.sh`. Every release updates `release.json`
(`engineeringVersion`, `releasedAt`), syncs `package.json`, and stages both into
the release commit *before* the build gate, so the badge bakes the correct
version.

| Option | Effect |
|---|---|
| `-m, --message <msg>` | Use this commit message (skips the prompt) |
| `-y, --yes` | Accept the proposed default message without prompting |
| `--dry-run` | Show every step without changing the repository (build still runs) |
| `-h, --help` | Show help |

### How the version is derived (phase mode)

The script reads the **Phase Execution Log** table in `docs/adr-011-progress.md`:

```
| Phase | Name | Version | Status | Started | Completed | Notes |
| A2    | Full ModuleManifest Type | V0.9.20 | Waiting | … |
```

For `release.sh A2` it resolves:

- **version** → `V0.9.20` (the tag to create)
- **title** → `Full ModuleManifest Type`
- **status** → `Waiting` (a warning is printed if the phase is already `Complete`)

If a Version cell holds two versions (e.g. `V0.9.28 → V1.0.0`, as Phase D4 does),
the **first** token is used — that is the dev-release version. The second is a
production-promote concern for v2.

If the phase id is not found, the script **fails fast** and lists the available
phase ids rather than guessing.

> ### Single source of truth
>
> **Every automated tool reads `docs/adr-011-progress.md` only. The roadmap
> (`docs/ADR-011-implementation-roadmap.md`) is archival documentation, not
> operational state.**
>
> `release.sh` does not fall back to the frozen roadmap, so the two can never
> disagree about which version a phase ships. Any future tool that needs phase or
> version data must read it through the `roadmap_*` helpers in `lib/common.sh` —
> never by grepping the roadmap or duplicating the lookup. The parsing strategy
> (currently a markdown table) is an internal detail of those helpers; callers
> depend only on the return contract, so the tracker can later move to
> JSON/YAML without touching any caller.

### Suggested commit message

In phase mode the proposed message is built from the roadmap:

```
V0.9.20 A2 — Full ModuleManifest Type (ADR-011)
```

The `(ADR-011)` suffix is derived from the progress document's title, not
hardcoded — set `INITIATIVE_LABEL` to override, or it is omitted if it can't be
derived. You can:

- press **Enter** to accept it,
- type a different message at the prompt,
- pass `-m "…"` to supply one non-interactively, or
- pass `-y` to accept the default with no prompt.

When stdin is not a terminal (CI, pipes) the default is accepted automatically.

In explicit-version mode the message follows the existing `V{version}: <message>`
convention from `CLAUDE.md`.

### What it does, in order

| Step | Action | Stops the run if… |
|---|---|---|
| 1 | Run `doctor.sh` | the repo is unhealthy |
| 2 | Verify the tag is unused (local **and** remote) | the tag already exists |
| 3 | Verify there are staged changes | nothing is staged |
| 4 | Resolve / confirm the commit message | — |
| 5 | **Build gate** — `npm run build` | the build fails |
| 6 | Create the commit | the commit fails |
| 7 | Create an **annotated** tag | tagging fails |
| 8 | Push the `dev` branch | the push fails |
| 9 | Push **only** the new tag | the push fails |
| 10 | Post-release verification (5 checks) | any check fails |
| 11 | Print summary + next-phase reminder | — |

Steps 1–5 make **no git changes** — if any of them fail (including the build),
the repository is left exactly as it was. With `--dry-run`, the run stops after
step 5 and prints the exact git commands it would have executed.

### Build gate

`npm run build` runs before any commit, tag, or push. A failed build aborts the
release immediately — nothing is committed. **This is mandatory and runs in
`--dry-run` too**, because a release that wouldn't build is the single thing most
worth catching, and dry-run is most useful when it actually validates. The build
writes only to gitignored output, never to tracked files.

**Deterministic clean build.** Immediately before running `$BUILD_CMD`, the script
removes the local Next.js build directory and then verifies it is actually gone:

```sh
rm -rf .next || die "Could not remove .next."
[ -e .next ] && die ".next still exists after cleanup. Release aborted."
```

A release build must never depend on previous artifacts. This is part of the
release tooling, not an application workaround. **Any future `verify.sh` must
follow exactly the same clean-build policy** (`rm -rf .next` + existence check
before building).

#### Root cause of the original `ENOTEMPTY` incident

The reported sequence was: `rm -rf .next` → `npm run build` (succeeds) →
`release.sh eng` → fails at the build gate with
`ENOTEMPTY: directory not empty, rmdir '.next/server'`.

Investigation findings:

- The release script runs the build **identically** to a manual run — same
  command (`npm run build`), same working directory (the repo root). It does not
  build under different conditions.
- No step in the script creates or touches `.next` before the build; the script
  leaves no filesystem state of its own behind.
- The failure only occurs when **building over an existing `.next` directory**.
  The manual `npm run build` succeeded because it was preceded by `rm -rf .next`,
  so it started clean; the script then ran a **second** build over that
  now-populated `.next` and hit the failed `rmdir '.next/server'`.

The existing `.next` directory contained macOS `.DS_Store` files (this repo's
`.next/` and `.next/server/` both have one), which are a plausible contributing
factor to a directory-removal step failing with `ENOTEMPTY`. However, the exact
internal cause within Next.js/Turbopack cannot be proven from our investigation.

Conclusion: regardless of the underlying implementation, the failure is tied to
reusing a non-empty `.next` between builds. Starting every release build from a
freshly removed `.next` directory eliminates the failure and guarantees a
deterministic release build. No further complexity is warranted.

The build command can be overridden with `BUILD_CMD` (used by the test suite to
stub the gate); leave it unset for normal releases.

### Post-release verification

After pushing, the script confirms all five of:

1. the commit exists,
2. the **annotated** tag exists,
3. the tag points to HEAD,
4. `origin/dev` equals local HEAD,
5. the tag exists on the remote.

Any failure aborts with a non-zero exit so you investigate before promoting.

### Next-phase reminder

On success the summary prints the next roadmap phase and its version, followed by
the standard promotion path:

```
1. Verify this release on https://dev.abluo.app
2. After approval, promote dev → preview and verify on https://preview.abluo.app
3. After preview verification, promote preview → production
```

### Why "push only the new tag"

The script runs `git push origin refs/tags/<tag>` — **never `git push --tags`**.
Pushing all tags can publish local or experimental tags never meant for the
remote. Releases push exactly one tag: the one derived for this release.

---

## `milestone.sh` — platform milestones

Tags a customer-facing platform milestone (`X.Y.0`). A milestone is never tied to
a roadmap phase; it tags an already-released, verified production commit.

```bash
./scripts/milestone.sh V1.1.0 -m "Module Installation"
./scripts/milestone.sh V1.1.0 --dry-run
```

Steps: verify branch is `main`, verify a clean tree, verify no unpushed commits,
**verify production is serving this commit via `/api/version`**, verify the tag is
unused, create + push an annotated tag (that tag only), then update `release.json`
(`platformVersion` + reset the engineering base to **this** milestone) and sync
`package.json`.

The production check polls `$PROD_URL/api/version` (default `https://abluo.app`)
and compares the served commit to local `HEAD` — no Vercel API or token. Use
`--skip-prod-check` to bypass it (not advised).

After `V1.1.0`, the engineering base becomes `V1.1.0`, so the next
`release.sh eng` produces `V1.1.0.1`. Commit the `release.json`/`package.json`
changes on `main`, merge back to `dev`, and add a `CHANGELOG.md` entry.

---

## Info commands — `next` and `status`

Both are **read-only**: no commit, no tag, no push, no build. They derive state
by cross-referencing the roadmap against **actual git tags**, so they stay
correct even when the progress tracker's status column is out of date.

- **current phase** = the last phase whose version tag exists
- **next phase** = the first phase whose version tag does *not* exist

The roadmap status column is shown for context but never trusted for the
recommendation — instead, any disagreement between git tags and the status column
is reported as **drift**.

### `release.sh next`

```text
  Current phase   A1 (Registry Relocation)
  Next phase      A2
  Version         V0.9.20
  Title           Full ModuleManifest Type
  Roadmap         Waiting

  Run:
    ./scripts/release.sh A2
```

### `release.sh status`

```text
  Current branch         dev
  HEAD                   bee83e0
  Last release           V0.9.19
  Current roadmap phase  A1 In Progress
  Next phase             A2 (V0.9.20) — Waiting
  Working tree           clean

⚠ Drift: A1 V0.9.19 is tagged but roadmap status is 'In Progress' (expected Complete)
⚠ Update docs/adr-011-progress.md to clear the drift above.
```

### Drift detection

For every phase, the tools compare the git tag against the roadmap status:

| Git | Roadmap status | Result |
|---|---|---|
| Tag exists | `Complete` | ✓ consistent |
| Tag exists | not `Complete` | ⚠ drift — tracker is behind reality |
| No tag | `Complete` | ⚠ drift — tracker claims a release that wasn't made |
| No tag | not `Complete` | ✓ consistent (not yet released) |

This is the mechanism that catches the stale-tracker problem until the tracker is
updated automatically (see the v1.2 candidate below). "Last release" uses the
tag nearest to HEAD (`git describe`), which is robust against the mixed-case tag
prefixes (`V…` and `v…`) in this repo's history.

---

## `doctor.sh`

Read-only repository health checks. `release.sh` runs it first and aborts if it
fails; you can also run it standalone for a status read. It never changes
anything.

| Check | Critical? |
|---|---|
| `git` installed | ✔ |
| Inside a git repository | ✔ |
| Current branch is `dev` | ✔ |
| No `.git/HEAD.lock` | ✔ |
| No merge in progress | ✔ |
| No rebase in progress | ✔ |
| Working tree status (staged / unstaged / untracked) | — |
| Remote `origin` reachable | ✔ |
| Local branch vs `origin` (behind / diverged = fail) | ✔ |
| Current tag status | — |

Exit `0` = healthy (warnings allowed); exit `1` = a critical check failed.

---

## Configuration

All configurable via environment variables — nothing initiative- or
tenant-specific is hardcoded.

| Variable | Default | Purpose |
|---|---|---|
| `RELEASE_BRANCH` | `dev` | Branch `release.sh` operates on |
| `MILESTONE_BRANCH` | `main` | Branch `milestone.sh` tags from |
| `ROADMAP_FILE` | `docs/adr-011-progress.md` | Progress doc parsed for phase → version |
| `RELEASE_JSON_FILE` | `release.json` | Version SSOT path |
| `PROD_URL` | `https://abluo.app` | Base URL for the milestone production check |
| `BUILD_CMD` | `npm run build` | The build gate command |
| `INITIATIVE_LABEL` | _(derived from doc H1)_ | Suffix in the default commit message |
| `NO_COLOR` | _(unset)_ | Set to disable coloured output |

---

## Troubleshooting

**`✖ Phase 'X' not found`**
The phase id is not in the Phase Execution Log. The error lists valid ids. Check
`docs/adr-011-progress.md`.

**`⚠ Roadmap marks phase X as 'Complete'`**
You named an already-finished phase; its version is probably released. The
tag-exists check (step 2) will stop a true duplicate.

**`✖ Build failed`**
`npm run build` did not succeed. Nothing was committed. Fix the build and re-run.

**`✖ HEAD.lock detected`** → `rm -f .git/HEAD.lock`

**`✖ Current branch is 'X', expected 'dev'`** → `git checkout dev`

**`✖ Local is behind origin`** → `git pull --ff-only origin dev`

**`✖ Local and origin have diverged`** → `git pull --rebase origin dev`

**`✖ No staged changes found`**
`release.sh` only commits what is staged. Run `git add <files>` first. This is
deliberate — it keeps releases to an explicit, reviewed set of changes.

**`✖ Remote 'origin' is not reachable`**
Network or authentication problem. Pushes must run from your local terminal — the
sandbox cannot authenticate to GitHub over HTTPS.

---

## Future roadmap

Built in modular stages; each reuses `lib/common.sh`.

### Release Automation 1.3 — `promote.sh` (next)
Automate `dev → preview → main`, **one hop at a time, never cascading**:

- Promote `dev → preview`, push, pause for verification at `preview.abluo.app`.
- Promote `preview → main`, push, pause for production verification.
- Use the `/api/version` poll to refuse a promotion when the previous environment
  isn't actually serving the expected commit.
- Enforce the explicit **Stop** hold points so a promotion can never skip a
  verification stage (root cause of the V0.8.2 incident). This is why promotion
  was deliberately deferred out of 1.2.
- Auto-generate a release-notes draft from git history for `CHANGELOG.md`.

### Later — `verify.sh`
A standalone quality gate, runnable on its own and reused by the other scripts:
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, and `build-log` generation.

### Delivered in 1.2
`release.json` SSOT, dual platform/engineering version model, `release.sh eng`
mode, `milestone.sh`, two-tier version badge, `package.json` auto-sync, and
doctor version-consistency checks.

### Candidate for a later iteration
Auto-update `docs/adr-011-progress.md` after a roadmap-phase release (mark the
phase `Complete`, advance Current/Next). The tooling reads the tracker but never
writes it.

---

## Design notes

- **Helpers live in `lib/common.sh`.** Colours, logging (`log_ok`, `hint`, …),
  git utilities (`tag_exists_local`, `merge_in_progress`, …) and roadmap parsers
  (`roadmap_lookup`, `roadmap_next_phase`, `roadmap_initiative`, …) are defined
  once and shared. Add new shared logic there so v2/v3 inherit it.
- **Log output goes to stderr**, keeping stdout clean for future machine-readable
  output (e.g. `verify.sh`).
- **Pre-flight vs operations.** All non-mutating checks — including the build —
  run before anything is committed, so an aborted pre-flight leaves the repo
  untouched.
- **No `git push --tags`, ever.** Only the named release tag is pushed.
- **Annotated tags only.**
