#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Abluo Release Automation v1 — doctor.sh
#
# Repository health checks for the localhost → dev release workflow.
#
# Run on its own to inspect repo health, or let release.sh run it first.
# Exits 0 when the repo is safe to release from, non-zero otherwise.
#
#   ./scripts/doctor.sh
#
# Exit codes:
#   0  all critical checks passed (warnings allowed)
#   1  one or more critical checks failed
# ---------------------------------------------------------------------------
set -euo pipefail

# Resolve our own directory so the script works from any CWD, then source libs.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

# Branch the release flow operates on. Override for local experiments only.
RELEASE_BRANCH="${RELEASE_BRANCH:-dev}"

# Counters drive the final summary and exit code.
FAILURES=0
WARNINGS=0

fail() { log_error "$1"; FAILURES=$((FAILURES + 1)); }
warn() { log_warn  "$1"; WARNINGS=$((WARNINGS + 1)); }
pass() { log_ok    "$1"; }

log_title "Abluo doctor — repository health checks"

# 1. git installed -----------------------------------------------------------
if git_present; then
  pass "git is installed ($(git --version | awk '{print $3}'))"
else
  hint "git is not installed or not on PATH" "Install git, then re-run ./scripts/doctor.sh"
  # Nothing else is meaningful without git.
  exit 1
fi

# Must be inside a work tree for everything below.
if ! in_git_repo; then
  hint "Not inside a git repository" "cd into the abluo-platform repo and re-run"
  exit 1
fi

# 2. current branch is the release branch ------------------------------------
BRANCH="$(current_branch)"
if [ "$BRANCH" = "$RELEASE_BRANCH" ]; then
  pass "On the '$RELEASE_BRANCH' branch"
else
  fail "Current branch is '$BRANCH', expected '$RELEASE_BRANCH'"
  printf '\n  %s\n\n' "${C_BOLD}git checkout $RELEASE_BRANCH${C_RESET}" >&2
fi

# 3. no HEAD.lock ------------------------------------------------------------
if head_lock_present; then
  hint "HEAD.lock detected" "rm -f .git/HEAD.lock"
  FAILURES=$((FAILURES + 1))
else
  pass "No .git/HEAD.lock"
fi

# 4. no merge in progress ----------------------------------------------------
if merge_in_progress; then
  hint "A merge is in progress" "git merge --abort   # or resolve and commit"
  FAILURES=$((FAILURES + 1))
else
  pass "No merge in progress"
fi

# 5. no rebase in progress ---------------------------------------------------
if rebase_in_progress; then
  hint "A rebase is in progress" "git rebase --abort   # or resolve and continue"
  FAILURES=$((FAILURES + 1))
else
  pass "No rebase in progress"
fi

# 6. working tree status -----------------------------------------------------
# Not a failure on its own: release.sh expects staged changes. We report the
# shape of the tree so the operator knows what will (and won't) be committed.
if work_tree_clean; then
  warn "Working tree is clean — nothing staged to release yet"
else
  if has_staged_changes; then
    STAGED_COUNT="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    pass "Working tree has changes ($STAGED_COUNT file(s) staged)"
  else
    warn "Working tree has changes but nothing is staged (run 'git add')"
  fi
  # Surface untracked files as information only.
  UNTRACKED="$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')"
  [ "$UNTRACKED" -gt 0 ] && log_info "$UNTRACKED untracked file(s) present"
fi

# 7. remote origin reachable -------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  if git ls-remote --quiet origin >/dev/null 2>&1; then
    pass "Remote 'origin' is reachable"
    ORIGIN_OK=1
  else
    fail "Remote 'origin' is configured but not reachable (network or auth?)"
    ORIGIN_OK=0
  fi
else
  fail "No 'origin' remote configured"
  ORIGIN_OK=0
fi

# 8. local branch status relative to origin ----------------------------------
if [ "${ORIGIN_OK:-0}" -eq 1 ] && [ "$BRANCH" = "$RELEASE_BRANCH" ]; then
  # Refresh remote-tracking ref without touching the working tree.
  git fetch --quiet origin "$RELEASE_BRANCH" 2>/dev/null || true
  if git rev-parse --verify -q "refs/remotes/origin/$RELEASE_BRANCH" >/dev/null; then
    LOCAL="$(rev HEAD)"
    REMOTE="$(rev "origin/$RELEASE_BRANCH")"
    BASE="$(git merge-base HEAD "origin/$RELEASE_BRANCH" 2>/dev/null || true)"
    if [ "$LOCAL" = "$REMOTE" ]; then
      pass "Local '$RELEASE_BRANCH' is in sync with origin"
    elif [ "$REMOTE" = "$BASE" ]; then
      AHEAD="$(git rev-list --count "origin/$RELEASE_BRANCH..HEAD")"
      log_info "Local is ahead of origin by $AHEAD commit(s) — release.sh will push them"
    elif [ "$LOCAL" = "$BASE" ]; then
      BEHIND="$(git rev-list --count "HEAD..origin/$RELEASE_BRANCH")"
      hint "Local is behind origin by $BEHIND commit(s)" "git pull --ff-only origin $RELEASE_BRANCH"
      FAILURES=$((FAILURES + 1))
    else
      hint "Local and origin have diverged" "git pull --rebase origin $RELEASE_BRANCH"
      FAILURES=$((FAILURES + 1))
    fi
  else
    warn "origin/$RELEASE_BRANCH does not exist yet — first push will create it"
  fi
else
  log_info "Skipping branch-vs-origin comparison"
fi

# 9. current tag status ------------------------------------------------------
# Informational: where HEAD sits relative to the most recent release tag.
LATEST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$LATEST_TAG" ]; then
  if git describe --tags --exact-match >/dev/null 2>&1; then
    EXACT="$(git describe --tags --exact-match)"
    log_info "HEAD is already tagged '$EXACT'"
  else
    SINCE="$(git rev-list --count "$LATEST_TAG"..HEAD)"
    log_info "Latest tag is '$LATEST_TAG' ($SINCE commit(s) ago)"
  fi
else
  log_info "No tags found in this repository yet"
fi

# 10. version consistency (git tag = source of truth) ------------------------
# Warnings only: drift is informational, not a release blocker on its own.
CURR_VER="$(current_release_version 2>/dev/null || true)"
if [ -n "$CURR_VER" ]; then
  log_info "Current release version (nearest lowercase tag): $CURR_VER"
  # release.json is a generated cache — it should match the current tag.
  RELEASE_JSON="$(release_json_path)"
  if [ -f "$RELEASE_JSON" ]; then
    RJ_VER="$(release_get version 2>/dev/null || true)"
    if [ "$RJ_VER" = "$CURR_VER" ]; then
      pass "release.json ($RJ_VER) matches the current tag"
    else
      warn "release.json version ($RJ_VER) != current tag ($CURR_VER) — it is regenerated on next release"
    fi
  else
    log_info "No release.json cache (build falls back to git describe)"
  fi
  # package.json mirrors the version without the leading 'v'.
  if node_present; then
    PKG_VER="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).version||""))}catch(e){}' "$(repo_root)/package.json" 2>/dev/null || true)"
    if [ "$PKG_VER" = "${CURR_VER#v}" ]; then
      pass "package.json version ($PKG_VER) matches the current tag"
    else
      warn "package.json version ($PKG_VER) != ${CURR_VER#v} — run a release to sync"
    fi
  fi
else
  log_info "No lowercase release tag yet (v2 baseline is v1.0.1)"
fi

# --- Summary ----------------------------------------------------------------
printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
if [ "$FAILURES" -eq 0 ]; then
  if [ "$WARNINGS" -eq 0 ]; then
    log_ok "${C_BOLD}Doctor passed — repository is healthy.${C_RESET}"
  else
    log_ok "${C_BOLD}Doctor passed${C_RESET} with $WARNINGS warning(s)."
  fi
  exit 0
else
  log_error "${C_BOLD}Doctor found $FAILURES problem(s)${C_RESET} (and $WARNINGS warning(s))."
  log_error "Resolve the items marked ✖ above, then re-run ./scripts/doctor.sh"
  exit 1
fi
