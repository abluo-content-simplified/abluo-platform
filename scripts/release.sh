#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Abluo Release Automation v1.1 — release.sh
#
# The standard Abluo release command. Cuts a release to the 'dev' branch with
# the version number derived from the ADR roadmap, so you never type it by hand.
#
#   ./scripts/release.sh A2                 # roadmap-driven (preferred)
#   ./scripts/release.sh A2 --dry-run       # show every step, change nothing
#   ./scripts/release.sh A2 -m "message"    # override the commit message
#   ./scripts/release.sh A2 --yes           # accept default message, no prompt
#
# Backward compatible — an explicit version still works:
#   ./scripts/release.sh V0.9.20 "ADR-011 A2 ModuleManifest"
#
# This version automates only localhost → dev. Promotion to Preview / Production
# remains manual until Release Automation v2 (promote.sh).
#
# Pipeline:
#   1. doctor.sh (health checks)
#   2. Resolve version + title from the roadmap (phase mode)
#   3. Verify the tag is unused (local + remote)
#   4. Verify staged changes exist
#   5. Confirm the commit message (default from roadmap, or your own)
#   6. Build gate — npm run build (abort on failure; runs in dry-run too)
#   7. Commit
#   8. Annotated tag
#   9. Push 'dev'
#  10. Push ONLY the new tag (never --tags)
#  11. Post-release verification
#  12. Summary + next-phase reminder
#
# Fail-fast: any error stops the run. Steps 1–6 make no git changes.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

# --- Configuration (override via env; nothing tenant/initiative specific is hardcoded) ---
RELEASE_BRANCH="${RELEASE_BRANCH:-dev}"
ROADMAP_FILE="${ROADMAP_FILE:-docs/adr-011-progress.md}"   # resolved against repo root
BUILD_CMD="${BUILD_CMD:-npm run build}"                    # the build gate command
INITIATIVE_LABEL="${INITIATIVE_LABEL:-}"                   # e.g. ADR-011; derived if empty

usage() {
  cat >&2 <<EOF
${C_BOLD}Usage:${C_RESET} ./scripts/release.sh <phase|version> [message] [options]

  ${C_BOLD}Phase mode (preferred)${C_RESET}
    ./scripts/release.sh A2
      Reads $ROADMAP_FILE, resolves the version and title for phase A2,
      and proposes a commit message you can accept or edit.

  ${C_BOLD}Explicit-version mode (backward compatible)${C_RESET}
    ./scripts/release.sh V0.9.20 "ADR-011 A2 ModuleManifest"

  ${C_BOLD}Read-only info commands${C_RESET}
    ./scripts/release.sh next     What to release next (+ the command to run)
    ./scripts/release.sh status   Branch, HEAD, last release, roadmap state, drift

  ${C_BOLD}Options${C_RESET}
    -m, --message <msg>   Use this commit message (skips the prompt)
    -y, --yes             Accept the default message without prompting
        --dry-run         Show every step without changing the repository
                          (the build gate still runs)
    -h, --help            Show this help
EOF
  exit 2
}

# --- Argument parsing -------------------------------------------------------
DRY_RUN=0
ASSUME_YES=0
CUSTOM_MSG=""
HAVE_CUSTOM_MSG=0
POSITIONAL=""
POSITIONAL2=""
POS_COUNT=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -m|--message)
      [ "$#" -ge 2 ] || { log_error "$1 requires a value"; usage; }
      CUSTOM_MSG="$2"; HAVE_CUSTOM_MSG=1; shift 2 ;;
    --message=*) CUSTOM_MSG="${1#*=}"; HAVE_CUSTOM_MSG=1; shift ;;
    -y|--yes)    ASSUME_YES=1; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   usage ;;
    --)          shift; while [ "$#" -gt 0 ]; do
                   POS_COUNT=$((POS_COUNT+1))
                   [ "$POS_COUNT" -eq 1 ] && POSITIONAL="$1"
                   [ "$POS_COUNT" -eq 2 ] && POSITIONAL2="$1"
                   shift
                 done ;;
    -*)          log_error "Unknown option: $1"; usage ;;
    *)           POS_COUNT=$((POS_COUNT+1))
                 [ "$POS_COUNT" -eq 1 ] && POSITIONAL="$1"
                 [ "$POS_COUNT" -eq 2 ] && POSITIONAL2="$1"
                 shift ;;
  esac
done

[ -n "$POSITIONAL" ] || { log_error "Missing phase or version argument."; usage; }

# --- Mode detection ---------------------------------------------------------
# If arg1 looks like a version tag, run the legacy explicit-version path.
# Otherwise treat it as a roadmap phase id.
MODE="phase"
if is_version_tag "$POSITIONAL"; then
  MODE="version"
fi

# Move to repo root so ROADMAP_FILE and the build command resolve consistently.
ROOT="$(repo_root)"
[ -n "$ROOT" ] || die "Not inside a git repository."
cd "$ROOT"

# --- Read-only subcommands: next / status -----------------------------------
# These derive state by cross-referencing the roadmap against actual git tags,
# so they stay correct even if the progress tracker's status column is stale.
# "current" = last phase whose version tag exists; "next" = first whose tag does
# not. Roadmap status is shown for context and drift is reported, not trusted.

TAB="$(printf '\t')"

# Walk the roadmap and split phases into released (tag exists) vs not.
# Sets globals: CUR_PHASE/CUR_VER/CUR_NAME (last released),
#               NXT_PHASE/NXT_VER/NXT_NAME/NXT_STATUS (first unreleased).
roadmap_resolve_state() {
  CUR_PHASE="" CUR_VER="" CUR_NAME=""
  NXT_PHASE="" NXT_VER="" NXT_NAME="" NXT_STATUS=""
  _found_next=0
  while IFS="$TAB" read -r _ph _ver _name _status; do
    [ -n "$_ph" ] || continue
    if [ -n "$_ver" ] && tag_exists_local "$_ver"; then
      CUR_PHASE="$_ph"; CUR_VER="$_ver"; CUR_NAME="$_name"
    elif [ "$_found_next" -eq 0 ]; then
      NXT_PHASE="$_ph"; NXT_VER="$_ver"; NXT_NAME="$_name"; NXT_STATUS="$_status"
      _found_next=1
    fi
  done <<EOF
$(roadmap_phases_tsv "$ROADMAP_FILE")
EOF
}

# Report any disagreement between git tags and the roadmap status column.
# Returns the number of drift items via the global DRIFT_COUNT.
roadmap_report_drift() {
  DRIFT_COUNT=0
  while IFS="$TAB" read -r _ph _ver _name _status; do
    [ -n "$_ph" ] || continue
    [ -n "$_ver" ] || continue
    _lc="$(printf '%s' "$_status" | tr '[:upper:]' '[:lower:]')"
    if tag_exists_local "$_ver"; then
      if [ "$_lc" != "complete" ]; then
        log_warn "Drift: $_ph $_ver is tagged but roadmap status is '$_status' (expected Complete)"
        DRIFT_COUNT=$((DRIFT_COUNT + 1))
      fi
    else
      if [ "$_lc" = "complete" ]; then
        log_warn "Drift: $_ph is marked Complete but tag $_ver does not exist"
        DRIFT_COUNT=$((DRIFT_COUNT + 1))
      fi
    fi
  done <<EOF
$(roadmap_phases_tsv "$ROADMAP_FILE")
EOF
}

cmd_next() {
  [ -f "$ROADMAP_FILE" ] || die "Roadmap file not found: $ROADMAP_FILE (set ROADMAP_FILE to override)."
  git fetch --tags --quiet origin 2>/dev/null || true
  roadmap_resolve_state
  printf '\n' >&2
  printf '  %-15s %s\n' "Current phase" "${CUR_PHASE:-—}${CUR_NAME:+ ($CUR_NAME)}" >&2
  if [ -n "$NXT_PHASE" ]; then
    printf '  %-15s %s\n' "Next phase"  "$NXT_PHASE" >&2
    printf '  %-15s %s\n' "Version"     "$NXT_VER" >&2
    printf '  %-15s %s\n' "Title"       "$NXT_NAME" >&2
    printf '  %-15s %s\n' "Roadmap"     "$NXT_STATUS" >&2
    printf '\n  %s\n    %s\n' "Run:" "${C_BOLD}./scripts/release.sh $NXT_PHASE${C_RESET}" >&2
  else
    printf '\n' >&2
    log_ok "All roadmap phases are released."
  fi
  roadmap_report_drift
  [ "${DRIFT_COUNT:-0}" -gt 0 ] && log_warn "Update $ROADMAP_FILE to clear the drift above."
  exit 0
}

cmd_status() {
  [ -f "$ROADMAP_FILE" ] || die "Roadmap file not found: $ROADMAP_FILE (set ROADMAP_FILE to override)."
  git fetch --tags --quiet origin 2>/dev/null || true
  _branch="$(current_branch)"
  _head="$(rev HEAD 2>/dev/null || echo '—')"
  # Most recent tag reachable from HEAD. Robust against the mixed-case tag
  # prefixes in this repo's history (which break `--sort=v:refname`).
  _last_tag="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  roadmap_resolve_state

  # Roadmap-reported status of the current (last released) phase.
  _cur_status=""
  if [ -n "$CUR_PHASE" ]; then
    _cur_status="$(roadmap_lookup "$ROADMAP_FILE" "$CUR_PHASE" 2>/dev/null | cut -f3)"
  fi

  printf '\n' >&2
  printf '  %-22s %s\n' "Current branch" "${_branch:-—}" >&2
  printf '  %-22s %s\n' "HEAD"           "$(printf '%s' "$_head" | cut -c1-7)" >&2
  printf '  %-22s %s\n' "Last release"   "${_last_tag:-—}" >&2
  printf '  %-22s %s\n' "Current roadmap phase" "${CUR_PHASE:-—}${_cur_status:+ $_cur_status}" >&2
  if [ -n "$NXT_PHASE" ]; then
    printf '  %-22s %s\n' "Next phase"    "$NXT_PHASE ($NXT_VER) — ${NXT_STATUS:-?}" >&2
  else
    printf '  %-22s %s\n' "Next phase"    "— (all released)" >&2
  fi
  if work_tree_clean; then
    printf '  %-22s %s\n' "Working tree"  "clean" >&2
  else
    _staged="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    _dirty="$(git status --porcelain | wc -l | tr -d ' ')"
    printf '  %-22s %s\n' "Working tree"  "$_dirty change(s), $_staged staged" >&2
  fi
  printf '\n' >&2
  roadmap_report_drift
  if [ "${DRIFT_COUNT:-0}" -eq 0 ]; then
    log_ok "Roadmap and git tags are consistent."
  else
    log_warn "Update $ROADMAP_FILE to clear the drift above."
  fi
  exit 0
}

case "$(printf '%s' "$POSITIONAL" | tr '[:upper:]' '[:lower:]')" in
  next)   cmd_next ;;
  status) cmd_status ;;
esac

PHASE=""
VERSION=""
PHASE_TITLE=""
DEFAULT_MSG=""

if [ "$MODE" = "version" ]; then
  VERSION="$POSITIONAL"
  if [ "$HAVE_CUSTOM_MSG" -eq 1 ]; then
    DEFAULT_MSG="$VERSION: $CUSTOM_MSG"
  elif [ -n "$POSITIONAL2" ]; then
    DEFAULT_MSG="$VERSION: $POSITIONAL2"
  else
    log_error "Explicit-version mode needs a message:"
    printf '\n  %s\n\n' "${C_BOLD}./scripts/release.sh $VERSION \"description\"${C_RESET}" >&2
    usage
  fi
  log_title "Abluo release — $VERSION (explicit version)"
else
  PHASE="$POSITIONAL"
  log_title "Abluo release — phase $PHASE (roadmap-driven)"
  [ -f "$ROADMAP_FILE" ] || die "Roadmap file not found: $ROADMAP_FILE (set ROADMAP_FILE to override)."

  if ! ROW="$(roadmap_lookup "$ROADMAP_FILE" "$PHASE")"; then
    log_error "Phase '$PHASE' not found in $ROADMAP_FILE."
    log_info "Available phases: $(roadmap_list_phases "$ROADMAP_FILE")"
    exit 1
  fi
  VERSION="$(printf '%s' "$ROW" | cut -f1)"
  PHASE_TITLE="$(printf '%s' "$ROW" | cut -f2)"
  PHASE_STATUS="$(printf '%s' "$ROW" | cut -f3)"

  [ -n "$VERSION" ] || die "No version found for phase '$PHASE' in the roadmap (check the Version column)."
  is_version_tag "$VERSION" || die "Roadmap version '$VERSION' for phase '$PHASE' is not a valid tag."

  # Derive the initiative label if not provided.
  if [ -z "$INITIATIVE_LABEL" ]; then
    INITIATIVE_LABEL="$(roadmap_initiative "$ROADMAP_FILE")"
  fi
  SUFFIX=""
  [ -n "$INITIATIVE_LABEL" ] && SUFFIX=" ($INITIATIVE_LABEL)"

  # Suggested message, e.g. "V0.9.20 A2 — Full ModuleManifest Type (ADR-011)"
  DEFAULT_MSG="$VERSION $PHASE — $PHASE_TITLE$SUFFIX"

  log_info "Phase    $PHASE — $PHASE_TITLE"
  log_info "Version  $VERSION   (status in roadmap: $PHASE_STATUS)"
  if [ "$PHASE_STATUS" = "Complete" ]; then
    log_warn "Roadmap marks phase $PHASE as 'Complete' — its version may already be released."
  fi
fi

[ "$DRY_RUN" -eq 1 ] && log_warn "DRY RUN — no commit, tag, or push will be made."

# --- Step 1: doctor ---------------------------------------------------------
log_step "Step 1 — Repository health checks (doctor.sh)"
if ! "$SCRIPT_DIR/doctor.sh"; then
  die "doctor.sh reported problems. Resolve them and try again. Nothing was changed."
fi

# --- Step 2: tag must not already exist -------------------------------------
log_step "Step 2 — Checking that tag '$VERSION' is unused"
if tag_exists_local "$VERSION"; then
  die "Tag '$VERSION' already exists locally. Nothing changed."
fi
if tag_exists_remote "$VERSION"; then
  die "Tag '$VERSION' already exists on origin. Nothing changed."
fi
log_ok "Tag '$VERSION' is available"

# --- Step 3: staged changes -------------------------------------------------
log_step "Step 3 — Verifying staged changes"
if ! has_staged_changes; then
  log_error "No staged changes found. Stage what you want to release first:"
  printf '\n  %s\n\n' "${C_BOLD}git add <files>${C_RESET}" >&2
  die "Nothing to commit (nothing changed)."
fi
STAGED_COUNT="$(git diff --cached --name-only | wc -l | tr -d ' ')"
log_ok "$STAGED_COUNT file(s) staged"
git diff --cached --stat >&2

# --- Step 4: resolve the commit message -------------------------------------
log_step "Step 4 — Commit message"
if [ "$HAVE_CUSTOM_MSG" -eq 1 ] && [ "$MODE" = "phase" ]; then
  MESSAGE="$CUSTOM_MSG"
  log_ok "Using provided message: $MESSAGE"
elif [ "$ASSUME_YES" -eq 1 ] || [ "$DRY_RUN" -eq 1 ] || [ ! -t 0 ]; then
  MESSAGE="$DEFAULT_MSG"
  log_ok "Using default message: $MESSAGE"
else
  printf '%s\n' "${C_DIM}Proposed:${C_RESET} ${C_BOLD}$DEFAULT_MSG${C_RESET}" >&2
  printf '%s' "Press Enter to accept, or type a different message: " >&2
  IFS= read -r REPLY_MSG || REPLY_MSG=""
  if [ -n "$REPLY_MSG" ]; then
    MESSAGE="$REPLY_MSG"
  else
    MESSAGE="$DEFAULT_MSG"
  fi
  log_ok "Commit message: $MESSAGE"
fi

# --- Step 5: build gate -----------------------------------------------------
# Runs in dry-run too: a release that wouldn't build is the thing most worth
# catching. The build writes only to gitignored output, never to tracked files.
log_step "Step 5 — Build gate ($BUILD_CMD)"
if ! sh -c "$BUILD_CMD" >&2; then
  die "Build failed. No commit, tag, or push was made."
fi
log_ok "Build succeeded"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
  log_warn "${C_BOLD}DRY RUN — the following would now run:${C_RESET}"
  cat >&2 <<EOF

  git commit -m "$MESSAGE"
  git tag -a "$VERSION" -m "$MESSAGE"
  git push origin $RELEASE_BRANCH
  git push origin refs/tags/$VERSION

  ${C_DIM}then verify: commit, annotated tag, tag→HEAD, origin/$RELEASE_BRANCH→HEAD, remote tag${C_RESET}
EOF
  log_ok "Dry run complete — repository unchanged."
  exit 0
fi

# Point of no return: everything above made no git changes.
log_info "Pre-flight complete — beginning release operations."

# --- Step 6: commit ---------------------------------------------------------
log_step "Step 6 — Creating commit"
git commit -m "$MESSAGE"
HEAD_SHA="$(rev HEAD)"
log_ok "Committed ${HEAD_SHA:0:9} — \"$MESSAGE\""

# --- Step 7: annotated tag --------------------------------------------------
log_step "Step 7 — Creating annotated tag '$VERSION'"
git tag -a "$VERSION" -m "$MESSAGE"
log_ok "Tagged $VERSION"

# --- Step 8: push branch ----------------------------------------------------
log_step "Step 8 — Pushing '$RELEASE_BRANCH'"
git push origin "$RELEASE_BRANCH"
log_ok "Pushed $RELEASE_BRANCH"

# --- Step 9: push ONLY the new tag ------------------------------------------
log_step "Step 9 — Pushing tag '$VERSION' (this tag only)"
git push origin "refs/tags/$VERSION"
log_ok "Pushed tag $VERSION"

# --- Step 10: post-release verification -------------------------------------
log_step "Step 10 — Post-release verification"
VERIFY_FAIL=0

# commit exists
if git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
  log_ok "Commit exists (${HEAD_SHA:0:9})"
else
  log_error "Commit ${HEAD_SHA:0:9} not found"; VERIFY_FAIL=1
fi

# annotated tag exists
if [ "$(git cat-file -t "$VERSION" 2>/dev/null)" = "tag" ]; then
  log_ok "Annotated tag '$VERSION' exists"
else
  log_error "Tag '$VERSION' is missing or not annotated"; VERIFY_FAIL=1
fi

# tag points to HEAD
TAG_SHA="$(rev "$VERSION^{commit}")"
if [ "$TAG_SHA" = "$HEAD_SHA" ]; then
  log_ok "Tag points to HEAD"
else
  log_error "Tag '$VERSION' ($TAG_SHA) does not point to HEAD ($HEAD_SHA)"; VERIFY_FAIL=1
fi

# remote dev matches HEAD
git fetch --quiet origin "$RELEASE_BRANCH"
REMOTE_SHA="$(rev "origin/$RELEASE_BRANCH")"
if [ "$REMOTE_SHA" = "$HEAD_SHA" ]; then
  log_ok "origin/$RELEASE_BRANCH matches HEAD"
else
  log_error "origin/$RELEASE_BRANCH ($REMOTE_SHA) != HEAD ($HEAD_SHA)"; VERIFY_FAIL=1
fi

# remote tag exists
if tag_exists_remote "$VERSION"; then
  log_ok "Remote tag '$VERSION' exists"
else
  log_error "Remote tag '$VERSION' not found on origin"; VERIFY_FAIL=1
fi

[ "$VERIFY_FAIL" -eq 0 ] || die "Post-release verification failed. Inspect the repository before promoting."

# --- Step 11: summary + next-phase reminder ---------------------------------
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo 'origin')"
printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
log_ok "${C_BOLD}Release $VERSION complete and verified.${C_RESET}"
cat >&2 <<EOF

  ${C_BOLD}Tag${C_RESET}      $VERSION  (annotated)
  ${C_BOLD}Commit${C_RESET}   ${HEAD_SHA:0:9}  $MESSAGE
  ${C_BOLD}Branch${C_RESET}   $RELEASE_BRANCH (pushed, in sync with origin)
  ${C_BOLD}Files${C_RESET}    $STAGED_COUNT changed
  ${C_BOLD}Remote${C_RESET}   $REMOTE_URL
EOF

# Next-phase reminder (phase mode only — needs the roadmap).
if [ "$MODE" = "phase" ]; then
  NEXT="$(roadmap_next_phase "$ROADMAP_FILE" "$PHASE" || true)"
  printf '\n' >&2
  if [ -n "$NEXT" ]; then
    NP="$(printf '%s' "$NEXT" | cut -f1)"
    NV="$(printf '%s' "$NEXT" | cut -f2)"
    NT="$(printf '%s' "$NEXT" | cut -f3)"
    printf '  %s %s\n' "${C_BOLD}Next phase${C_RESET}" "$NP — $NT" >&2
    printf '  %s %s\n' "${C_BOLD}Next ver. ${C_RESET}" "$NV" >&2
  else
    log_info "This was the final phase in the roadmap."
  fi
fi

cat >&2 <<EOF

  ${C_BOLD}Next steps${C_RESET}
    1. Verify this release on ${C_BOLD}https://dev.abluo.app${C_RESET}
    2. After approval, promote ${C_BOLD}dev → preview${C_RESET} and verify on https://preview.abluo.app
    3. After preview verification, promote ${C_BOLD}preview → production${C_RESET}

  ${C_DIM}Promotion is manual until Release Automation v2 (promote.sh).${C_RESET}
EOF
