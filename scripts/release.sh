#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Abluo Release Automation v2 — release.sh
#
# Cuts a release. There is ONE version concept — the Platform Version — carried
# by an annotated git tag (the single source of truth). No engineering version.
#
#   ./scripts/release.sh v1.0.2 "Location Platform"   # version + title
#   ./scripts/release.sh v1.0.2                        # title optional
#   ./scripts/release.sh                               # interactive prompts
#   ./scripts/release.sh v1.0.2 --dry-run             # show steps, change nothing
#
# What it does:
#   1. Validate the version (lowercase vX.Y.Z) and that the tag is unused
#   2. Health checks (doctor) + deterministic build gate (rm -rf .next + build)
#   3. Regenerate release.json + sync package.json (build-time fallbacks)
#   4. Create a release-marker commit:  release: v1.0.2 - Location Platform
#   5. Create the annotated tag (message = title)
#   6. Push the branch and ONLY the new tag (never --tags)
#   7. Verify, then print a structured summary
#
# The deployment pipeline (localhost -> dev -> preview -> production) is
# unchanged: cut the release on dev, then promote as usual.
# Fail-fast: any error stops the run. Steps 1-3 make no git commits.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

RELEASE_BRANCH="${RELEASE_BRANCH:-dev}"
BUILD_CMD="${BUILD_CMD:-npm run build}"

usage() {
  cat >&2 <<EOF
${C_BOLD}Usage:${C_RESET} ./scripts/release.sh [version] [title] [--dry-run]

  ${C_BOLD}version${C_RESET}   Platform Version — lowercase, e.g. ${C_BOLD}v1.0.2${C_RESET}
            (must be vX.Y.Z; uppercase V and four-segment forms are rejected)
  ${C_BOLD}title${C_RESET}     Release title — optional, e.g. "Location Platform"

  If arguments are omitted you'll be prompted. Title may be left blank.

  ${C_BOLD}Options${C_RESET}
    --dry-run   Show every step (incl. the build) without changing the repo
    -h, --help  Show this help
EOF
  exit 2
}

# --- Parse arguments --------------------------------------------------------
DRY_RUN=0
VERSION=""
TITLE=""
TITLE_SET=0
POS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    -*)        log_error "Unknown option: $1"; usage ;;
    *)
      POS=$((POS + 1))
      if [ "$POS" -eq 1 ]; then VERSION="$1"; else TITLE="$1"; TITLE_SET=1; fi
      shift ;;
  esac
done

ROOT="$(repo_root)"; [ -n "$ROOT" ] || die "Not inside a git repository."
cd "$ROOT"

# --- Interactive prompts (only when not supplied / not a pipe) --------------
if [ -z "$VERSION" ]; then
  if [ -t 0 ]; then
    printf '%s' "${C_BOLD}Platform Version${C_RESET} (e.g. v1.0.2): " >&2
    IFS= read -r VERSION || VERSION=""
  fi
  [ -n "$VERSION" ] || { log_error "A Platform Version is required."; usage; }
fi
if [ "$TITLE_SET" -eq 0 ] && [ -t 0 ]; then
  printf '%s' "${C_BOLD}Release Title${C_RESET} (optional, Enter to skip): " >&2
  IFS= read -r TITLE || TITLE=""
fi

# --- Validate version -------------------------------------------------------
if ! is_release_version "$VERSION"; then
  log_error "'$VERSION' is not a valid release version."
  printf '\n  Use a lowercase semantic version: %s\n' "${C_BOLD}vX.Y.Z${C_RESET} (e.g. v1.0.2)" >&2
  printf '  Uppercase V and four-segment versions (v1.0.0.2) are not allowed.\n\n' >&2
  usage
fi

# Compose the release-marker commit message and the tag message (title).
if [ -n "$TITLE" ]; then
  COMMIT_MSG="release: $VERSION - $TITLE"
  TAG_MSG="$TITLE"
else
  COMMIT_MSG="release: $VERSION"
  TAG_MSG="$VERSION"
fi

log_title "Abluo release — $VERSION"
[ -n "$TITLE" ] && log_info "Title: $TITLE" || log_info "Title: (none)"
[ "$DRY_RUN" -eq 1 ] && log_warn "DRY RUN — no commit, tag, or push will be made."

# --- Step 1: health checks --------------------------------------------------
log_step "Step 1 — Repository health checks (doctor.sh)"
"$SCRIPT_DIR/doctor.sh" || die "doctor.sh reported problems. Resolve them and retry. Nothing changed."

# --- Step 2: tag must be unused ---------------------------------------------
log_step "Step 2 — Checking that tag '$VERSION' is unused"
tag_exists_local "$VERSION"  && die "Tag '$VERSION' already exists locally. Choose a new version."
tag_exists_remote "$VERSION" && die "Tag '$VERSION' already exists on origin. Choose a new version."
log_ok "Tag '$VERSION' is available"

# --- Step 3: regenerate version metadata (release.json + package.json) -------
# Generated from the version/title BEFORE the build so the bundle bakes the
# correct version, and staged into the release-marker commit. The git tag (made
# in Step 5) remains the source of truth; these files are build-time fallbacks.
log_step "Step 3 — Generating version metadata"
if [ "$DRY_RUN" -eq 1 ]; then
  log_info "[dry-run] would write release.json: version=$VERSION, title=${TITLE:-<none>}"
  log_info "[dry-run] would sync package.json version=${VERSION#v}"
else
  generate_release_json "$VERSION" "$TITLE"
  sync_package_version "$VERSION"
  git add release.json package.json
  log_ok "release.json + package.json regenerated for $VERSION"
fi

# --- Step 4: build gate (deterministic clean build) -------------------------
# Always start from a clean .next directory; building over an existing .next has
# produced "ENOTEMPTY: ... rmdir .next/server" failures (internal cause in
# Next.js/Turbopack unproven). Removing .next first makes the build deterministic.
log_step "Step 4 — Build gate ($BUILD_CMD)"
if [ -d ".next" ]; then
  rm -rf .next || die "Could not remove .next. Delete it manually (rm -rf .next) and retry."
  log_info "Removed existing .next (deterministic clean build)"
fi
[ -e ".next" ] && die ".next still exists after cleanup. Stop any running 'npm run dev', then retry."
sh -c "$BUILD_CMD" >&2 || die "Build failed. No commit, tag, or push was made."
log_ok "Build succeeded"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
  log_warn "${C_BOLD}DRY RUN — the following would now run:${C_RESET}"
  cat >&2 <<EOF

  git add release.json package.json
  git commit -m "$COMMIT_MSG"
  git tag -a "$VERSION" -m "$TAG_MSG"
  git push origin $RELEASE_BRANCH
  git push origin refs/tags/$VERSION

  ${C_DIM}then promote $RELEASE_BRANCH -> preview -> production as usual.${C_RESET}
EOF
  log_ok "Dry run complete — repository unchanged."
  exit 0
fi

# Point of no return — everything above made no commit.
log_info "Pre-flight complete — creating the release."

# --- Step 5: release-marker commit ------------------------------------------
# A single commit titled "release: <version> - <title>" so Vercel deployments
# read as releases. --allow-empty covers the case where metadata didn't change.
log_step "Step 5 — Creating release-marker commit"
git commit --allow-empty -m "$COMMIT_MSG"
HEAD_SHA="$(rev HEAD)"
log_ok "Committed ${HEAD_SHA:0:9} — \"$COMMIT_MSG\""

# --- Step 6: annotated tag --------------------------------------------------
log_step "Step 6 — Creating annotated tag '$VERSION'"
git tag -a "$VERSION" -m "$TAG_MSG"
log_ok "Tagged $VERSION (message: \"$TAG_MSG\")"

# --- Step 7: push branch, then ONLY the new tag -----------------------------
log_step "Step 7 — Pushing '$RELEASE_BRANCH' and tag '$VERSION'"
git push origin "$RELEASE_BRANCH"
git push origin "refs/tags/$VERSION"
log_ok "Pushed $RELEASE_BRANCH and tag $VERSION"

# --- Step 8: verification ---------------------------------------------------
log_step "Step 8 — Post-release verification"
VERIFY_FAIL=0
[ "$(git cat-file -t "$VERSION" 2>/dev/null)" = "tag" ] || { log_error "Tag is missing or not annotated"; VERIFY_FAIL=1; }
[ "$(rev "$VERSION^{commit}")" = "$HEAD_SHA" ] || { log_error "Tag does not point to HEAD"; VERIFY_FAIL=1; }
git fetch --quiet origin "$RELEASE_BRANCH"
[ "$(rev "origin/$RELEASE_BRANCH")" = "$HEAD_SHA" ] || { log_error "origin/$RELEASE_BRANCH != HEAD"; VERIFY_FAIL=1; }
tag_exists_remote "$VERSION" || { log_error "Remote tag '$VERSION' not found"; VERIFY_FAIL=1; }
[ "$VERIFY_FAIL" -eq 0 ] || die "Post-release verification failed. Inspect before promoting."
log_ok "Commit, annotated tag, and remote are all consistent"

# --- Step 9: summary --------------------------------------------------------
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo origin)"
printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
log_ok "${C_BOLD}Release $VERSION complete and verified.${C_RESET}"
cat >&2 <<EOF

  ${C_BOLD}Version${C_RESET}      $VERSION  (annotated tag — source of truth)
  ${C_BOLD}Title${C_RESET}        ${TITLE:-(none)}
  ${C_BOLD}Commit${C_RESET}       ${HEAD_SHA:0:9}  $COMMIT_MSG
  ${C_BOLD}Branch${C_RESET}       $RELEASE_BRANCH (pushed)
  ${C_BOLD}Remote${C_RESET}       $REMOTE_URL

  ${C_BOLD}Next${C_RESET}
    1. Verify on ${C_BOLD}https://dev.abluo.app${C_RESET}
    2. Promote ${C_BOLD}dev → preview${C_RESET} (ff), verify on https://preview.abluo.app
    3. Promote ${C_BOLD}preview → production${C_RESET} (ff), verify on https://abluo.app
  ${C_DIM}Vercel will show this deploy as: "$COMMIT_MSG"${C_RESET}
EOF
