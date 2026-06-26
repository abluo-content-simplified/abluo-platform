# Release Automation

Developer tooling for cutting Abluo releases safely and repeatably.

This is **platform developer tooling**, not part of ADR-011. It exists to replace
the error-prone manual release steps that previously had to be run by hand (and
which caused incidents such as the V0.8.2 production break).

**The current version (v1.1) automates only the `localhost → dev` workflow.** It
derives the version from the roadmap, gates on a successful build, commits, tags,
pushes to `dev`, and verifies the result. It does **not** promote to Preview or
Production — those remain manual until [Release Automation v2](#future-roadmap).

---

## Scripts

```
scripts/
  doctor.sh        # repository health checks
  release.sh       # the command you normally run
  lib/
    common.sh      # shared helpers: colours, logging, git + roadmap utilities
```

All three are POSIX-friendly shell scripts. `doctor.sh` and `release.sh` use
`set -euo pipefail` and source `lib/common.sh`, so future scripts (`promote.sh`,
`verify.sh`) reuse the same helpers without duplication.

---

## Quick start

```bash
# 1. Stage the changes you want to release
git add <files>

# 2. Cut the release for a roadmap phase — no version number needed
./scripts/release.sh A2
```

`A2` is a phase id from the Phase Execution Log in `docs/adr-011-progress.md`.
The script looks up the version (`V0.9.20`) and title ("Full ModuleManifest
Type"), proposes a commit message, runs the build, and releases.

Preview exactly what would happen, changing nothing:

```bash
./scripts/release.sh A2 --dry-run
```

Ask the tooling what to release next, or check current state — no changes, no
build:

```bash
./scripts/release.sh next      # what to release next + the command to run
./scripts/release.sh status    # branch, HEAD, last release, roadmap state, drift
```

Run the health checks on their own at any time:

```bash
./scripts/doctor.sh
```

---

## `release.sh`

### Usage

```
./scripts/release.sh <phase|version> [message] [options]
```

| Form | Example | Notes |
|---|---|---|
| **Phase mode** (preferred) | `./scripts/release.sh A2` | Version + message derived from the roadmap |
| **Explicit-version mode** | `./scripts/release.sh V0.9.20 "ADR-011 A2 ModuleManifest"` | Backward compatible — message required |

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
| `RELEASE_BRANCH` | `dev` | Branch the workflow operates on |
| `ROADMAP_FILE` | `docs/adr-011-progress.md` | Progress doc parsed for phase → version |
| `BUILD_CMD` | `npm run build` | The build gate command |
| `INITIATIVE_LABEL` | _(derived from doc H1)_ | Suffix in the default commit message |
| `NO_COLOR` | _(unset)_ | Set to disable coloured output |

---

## Expected workflow

```
┌───────────┐  git add   ┌──────────────┐  release.sh A2  ┌────────────┐
│ localhost │ ─────────▶ │ staged change│ ──────────────▶ │ origin/dev │
└───────────┘            └──────────────┘                 └────────────┘
                          (build gate must pass)                 │
                                                        Vercel builds dev
                                                                 ▼
                                                     https://dev.abluo.app
```

1. Develop and test locally.
2. `git add` the changes for the release.
3. `./scripts/release.sh <phase>` (the build gate enforces `npm run build`).
4. Verify the deploy at **https://dev.abluo.app**.
5. Promote `dev → preview → main` manually per `CLAUDE.md` (until v2).

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

### Release Automation v2 — `promote.sh`
Automate `dev → preview → main`:

- Promote `dev → preview`, push, pause for verification at `preview.abluo.app`.
- Promote `preview → main`, tag the release (incl. the production version such as
  D4's `V1.0.0`), and push.
- Enforce the explicit **Stop** hold points so a promotion can never skip a
  verification stage (root cause of the V0.8.2 incident).

### Release Automation v3 — `verify.sh`
A standalone quality gate, runnable on its own and reused by `release.sh`:

- `npx tsc --noEmit`
- `npx vitest run`
- `npm run build`
- generate / append the `build-log-V{version}.txt` entry.

### Candidate for v1.2
Auto-update `docs/adr-011-progress.md` after a successful release (mark the phase
`Complete`, advance Current/Next phase). v1.1 reads the tracker but never writes
it.

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
