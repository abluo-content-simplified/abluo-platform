#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Abluo Release Automation 1.2 — milestone.sh
#
# Tag a PLATFORM milestone (customer-facing product version, e.g. V1.1.0).
# A milestone is never tied to a roadmap phase. Engineering iterations are cut
# with release.sh; this script is only for platform milestones (X.Y.0).
#
#   ./scripts/milestone.sh V1.1.0
#   ./scripts/milestone.sh V1.1.0 --dry-run
#   ./scripts/milestone.sh V1.1.0 -m "Module Installation"
#
# A milestone tags an ALREADY-RELEASED, verified production commit — it does not
# create a code commit. It:
#   1. verifies branch (main) and a clean working tree
#   2. verifies no unpushed commits
#   3. verifies production is actually serving this commit (via /api/version)
#   4. verifies the tag is unused
#   5. creates an annotated tag and pushes only that tag
#   6. updates release.json (platformVersion + engineering base reset)
#   7. syncs package.json and prints a structured summary
#
# Fail-fast: any error stops the run.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

MILESTONE_BRANCH="${MILESTONE_BRANCH:-main}"
PROD_URL="${PROD_URL:-https://abluo.app}"
VERSION_ENDPOINT="${VERSION_ENDPOINT:-/api/version}"

usage() {
  cat >&2 <<EOF
${C_BOLD}Usage:${C_RESET} ./scripts/milestone.sh <Vx.y.0> [-m "name"] [--dry-run]

  Tags a customer-facing platform milestone on '$MILESTONE_BRANCH'.

  ${C_BOLD}Options${C_RESET}
    -m, --message <name>   Milestone name (default: release.json releaseName)
        --dry-run          Show every step without changing anything
        --skip-prod-check  Skip the live production verification (not advised)
    -h, --help             Show this help
EOF
  exit 2
}

DRY_RUN=0
SKIP_PROD=0
CUSTOM_MSG=""
HAVE_CUSTOM_MSG=0
VERSION=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -m|--message) [ "$#" -ge 2 ] || { log_error "$1 requires a value"; usage; }
                  CUSTOM_MSG="$2"; HAVE_CUSTOM_MSG=1; shift 2 ;;
    --message=*)  CUSTOM_MSG="${1#*=}"; HAVE_CUSTOM_MSG=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --skip-prod-check) SKIP_PROD=1; shift ;;
    -h|--help)    usage ;;
    -*)           log_error "Unknown option: $1"; usage ;;
    *)            [ -z "$VERSION" ] && VERSION="$1"; shift ;;
  esac
done

[ -n "$VERSION" ] || { log_error "Missing milestone version."; usage; }

if ! is_milestone_version "$VERSION"; then
  log_error "'$VERSION' is not a platform-milestone version."
  printf '\n  Milestones are %s (e.g. V1.1.0). For engineering iterations use:\n  %s\n\n' \
    "${C_BOLD}V<major>.<minor>.0${C_RESET}" "${C_BOLD}./scripts/release.sh eng${C_RESET}" >&2
  usage
fi

ROOT="$(repo_root)"; [ -n "$ROOT" ] || die "Not inside a git repository."
cd "$ROOT"

RELEASE_NAME="$CUSTOM_MSG"
[ "$HAVE_CUSTOM_MSG" -eq 1 ] || RELEASE_NAME="$(release_get releaseName 2>/dev/null || true)"
TAG_MSG="$VERSION${RELEASE_NAME:+ — $RELEASE_NAME}"

log_title "Abluo milestone — $VERSION"
log_info "Name: ${RELEASE_NAME:-<none>}"
[ "$DRY_RUN" -eq 1 ] && log_warn "DRY RUN — no tag will be created or pushed."

# --- 1. branch --------------------------------------------------------------
log_step "Step 1 — Verifying branch"
git_present || die "git is not installed."
BRANCH="$(current_branch)"
if [ "$BRANCH" != "$MILESTONE_BRANCH" ]; then
  die "Milestones must be tagged from '$MILESTONE_BRANCH' (on '$BRANCH'). Run: git checkout $MILESTONE_BRANCH"
fi
log_ok "On '$MILESTONE_BRANCH'"

# --- 2. clean working tree --------------------------------------------------
log_step "Step 2 — Verifying clean working tree"
work_tree_clean || die "Working tree is not clean. A milestone must tag a committed, verified state."
log_ok "Working tree is clean"

# --- 3. no unpushed commits -------------------------------------------------
log_step "Step 3 — Verifying no pending commits"
git fetch --quiet origin "$MILESTONE_BRANCH" 2>/dev/null || die "Could not reach origin."
LOCAL_SHA="$(rev HEAD)"
REMOTE_SHA="$(rev "origin/$MILESTONE_BRANCH" 2>/dev/null || true)"
[ -n "$REMOTE_SHA" ] || die "origin/$MILESTONE_BRANCH not found."
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  die "Local '$MILESTONE_BRANCH' ($(printf '%s' "$LOCAL_SHA" | cut -c1-7)) != origin ($(printf '%s' "$REMOTE_SHA" | cut -c1-7)). Push or pull first."
fi
log_ok "Local and origin/$MILESTONE_BRANCH agree (${LOCAL_SHA:0:7})"

# --- 4. production is serving this commit -----------------------------------
# Uses the deployed /api/version endpoint (no Vercel API dependency).
log_step "Step 4 — Verifying production deployment"
if [ "$SKIP_PROD" -eq 1 ]; then
  log_warn "Skipping production verification (--skip-prod-check)"
elif ! command -v curl >/dev/null 2>&1; then
  log_warn "curl not available — cannot verify production. Re-run with curl, or --skip-prod-check."
else
  PROD_JSON="$(curl -fsS --max-time 15 "$PROD_URL$VERSION_ENDPOINT" 2>/dev/null || true)"
  if [ -z "$PROD_JSON" ]; then
    die "Could not read $PROD_URL$VERSION_ENDPOINT. Verify the deploy is live (or use --skip-prod-check)."
  fi
  PROD_COMMIT="$(printf '%s' "$PROD_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.commitLong||j.commit||""))}catch(e){}})')"
  if [ -z "$PROD_COMMIT" ]; then
    log_warn "Production responded but exposed no commit — proceeding without commit match."
  elif [ "$PROD_COMMIT" = "$LOCAL_SHA" ] || [ "${LOCAL_SHA#"$PROD_COMMIT"}" != "$LOCAL_SHA" ]; then
    log_ok "Production is serving this commit (${PROD_COMMIT})"
  else
    die "Production is serving $PROD_COMMIT, not $LOCAL_SHA. Promote + verify production before tagging the milestone."
  fi
fi

# --- 5. tag unused ----------------------------------------------------------
log_step "Step 5 — Checking that tag '$VERSION' is unused"
tag_exists_local "$VERSION"  && die "Tag '$VERSION' already exists locally."
tag_exists_remote "$VERSION" && die "Tag '$VERSION' already exists on origin."
log_ok "Tag '$VERSION' is available"

# --- Engineering base reset (computed for summary + post-tag write) ----------
# Canonical rule: engineering inherits the CURRENT milestone. After V1.1.0 the
# base becomes V1.1.0, so the next engineering iteration is V1.1.0.1.
ENG_BASE="$VERSION"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
  log_warn "${C_BOLD}DRY RUN — the following would run:${C_RESET}"
  cat >&2 <<EOF

  git tag -a "$VERSION" -m "$TAG_MSG"
  git push origin refs/tags/$VERSION
  release.json → platformVersion=$VERSION, engineeringVersion=$ENG_BASE (base = this milestone)
  package.json → version=${VERSION#[Vv]}

  ${C_DIM}next engineering iteration would then be: $(engineering_next "$ENG_BASE")${C_DIM}
EOF
  log_ok "Dry run complete — nothing changed."
  exit 0
fi

# --- 6. annotated tag + push (tag only) -------------------------------------
log_step "Step 6 — Creating and pushing annotated milestone tag"
git tag -a "$VERSION" -m "$TAG_MSG"
git push origin "refs/tags/$VERSION"
log_ok "Tagged and pushed $VERSION"

# --- 7. update release.json + package.json ----------------------------------
log_step "Step 7 — Updating version SSOT"
release_set platformVersion "$VERSION"
# Reset the engineering base to THIS milestone so the next eng iteration becomes
# <thisMilestone>.1 (e.g. after V1.1.0, base V1.1.0 → next V1.1.0.1).
release_set engineeringVersion "$ENG_BASE"
release_set releasedAt "$(today_iso)"
[ -n "$RELEASE_NAME" ] && release_set releaseName "$RELEASE_NAME"
sync_package_version "$VERSION"
log_ok "release.json platformVersion=$VERSION, engineering base=$ENG_BASE; package.json=${VERSION#[Vv]}"
log_warn "release.json/package.json changed — commit them on $MILESTONE_BRANCH (and merge back to dev)."

# --- 8. verification --------------------------------------------------------
log_step "Step 8 — Verifying milestone tag"
[ "$(git cat-file -t "$VERSION" 2>/dev/null)" = "tag" ] || die "Tag '$VERSION' is not annotated."
tag_exists_remote "$VERSION" || die "Tag '$VERSION' not found on origin."
log_ok "Annotated milestone tag '$VERSION' present locally and on origin"

# --- 9. summary -------------------------------------------------------------
printf '\n%s\n' "${C_DIM}--------------------------------------------------${C_RESET}" >&2
log_ok "${C_BOLD}Platform milestone $VERSION released.${C_RESET}"
cat >&2 <<EOF

  ${C_BOLD}Environment${C_RESET}          production ($MILESTONE_BRANCH)
  ${C_BOLD}Commit${C_RESET}               ${LOCAL_SHA:0:9}
  ${C_BOLD}Platform version${C_RESET}     $VERSION  (annotated tag, customer-facing)
  ${C_BOLD}Engineering base${C_RESET}     $ENG_BASE  (next iteration: $(engineering_next "$ENG_BASE"))
  ${C_BOLD}Deployment${C_RESET}           $PROD_URL

  ${C_BOLD}Next recommended actions${C_RESET}
    1. Commit the release.json/package.json changes on $MILESTONE_BRANCH
    2. Merge $MILESTONE_BRANCH back to dev so the SSOT stays consistent
    3. Add a $VERSION entry to CHANGELOG.md (human-readable milestone history)
EOF
