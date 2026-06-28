#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Abluo Release Automation — shared helper library
#
# POSIX sh. Sourced by doctor.sh, release.sh and (future) promote.sh / verify.sh.
# Contains: colour handling, logging helpers, and small git utilities.
#
# Nothing in this file should `exit` on its own — callers decide control flow.
# Helpers return 0 (ok) / non-zero (problem) so callers can compose them.
# ---------------------------------------------------------------------------

# --- Colours ---------------------------------------------------------------
# Honour NO_COLOR (https://no-color.org) and only colourise a real terminal.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_RED="$(printf '\033[31m')"
  C_GREEN="$(printf '\033[32m')"
  C_YELLOW="$(printf '\033[33m')"
  C_BLUE="$(printf '\033[34m')"
  C_CYAN="$(printf '\033[36m')"
else
  C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_CYAN=""
fi

# --- Logging ---------------------------------------------------------------
# All log output goes to stderr so it never pollutes a script's stdout, which
# may be captured (e.g. a future verify.sh emitting machine-readable data).

log_info()  { printf '%s\n' "${C_DIM}·${C_RESET} $*" >&2; }
log_ok()    { printf '%s\n' "${C_GREEN}✔${C_RESET} $*" >&2; }
log_warn()  { printf '%s\n' "${C_YELLOW}⚠${C_RESET} $*" >&2; }
log_error() { printf '%s\n' "${C_RED}✖${C_RESET} $*" >&2; }
log_step()  { printf '\n%s\n' "${C_BOLD}${C_BLUE}▸ $*${C_RESET}" >&2; }

# Heading used at the top of a script run.
log_title() {
  printf '\n%s\n%s\n' \
    "${C_BOLD}${C_CYAN}$*${C_RESET}" \
    "${C_DIM}--------------------------------------------------${C_RESET}" >&2
}

# A "fix it like this" block: a message, a blank line, then an indented command.
# Usage: hint "HEAD.lock detected" "rm -f .git/HEAD.lock"
hint() {
  _msg="$1"
  _cmd="${2:-}"
  log_error "$_msg"
  if [ -n "$_cmd" ]; then
    printf '\n  %s\n\n' "${C_BOLD}${_cmd}${C_RESET}" >&2
  fi
}

# Hard stop. Prints an error and exits non-zero. `set -e` callers can also just
# `return 1`, but this gives a consistent exit path for fatal conditions.
die() {
  log_error "$*"
  exit 1
}

# --- Git utilities ---------------------------------------------------------

# Is `git` on PATH?
git_present() { command -v git >/dev/null 2>&1; }

# Are we inside a git work tree?
in_git_repo() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }

# Absolute path to the repo root, or empty.
repo_root() { git rev-parse --show-toplevel 2>/dev/null; }

# Absolute path to the .git dir (handles worktrees), or empty.
git_dir() { git rev-parse --git-dir 2>/dev/null; }

# Current branch name (empty if detached).
current_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }

# True when the working tree + index are clean.
work_tree_clean() { [ -z "$(git status --porcelain 2>/dev/null)" ]; }

# True when there are staged (cached) changes ready to commit.
has_staged_changes() { ! git diff --cached --quiet 2>/dev/null; }

# True when a merge is in progress.
merge_in_progress() { [ -f "$(git_dir)/MERGE_HEAD" ]; }

# True when a rebase is in progress (apply or merge backend).
rebase_in_progress() {
  _gd="$(git_dir)"
  [ -d "$_gd/rebase-merge" ] || [ -d "$_gd/rebase-apply" ]
}

# True when a HEAD.lock file is present.
head_lock_present() { [ -f "$(git_dir)/HEAD.lock" ]; }

# Does a tag exist locally?  tag_exists_local <tag>
tag_exists_local() { git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1; }

# Does a tag exist on origin?  tag_exists_remote <tag>
tag_exists_remote() {
  [ -n "$(git ls-remote --tags origin "refs/tags/$1" 2>/dev/null)" ]
}

# Resolve a ref to a full commit SHA.  rev <ref>
rev() { git rev-parse "$1" 2>/dev/null; }

# --- Version model (v2: single source of truth = the git tag) --------------
# Abluo has ONE version: the Platform Version, carried by an annotated git tag.
#   * tag name    = version   (lowercase, e.g. v1.0.2)
#   * tag message = title     (e.g. "Location Platform")
# There is no engineering version. Builds are identified by metadata
# (commit SHA + branch + environment + build time), never by a number.

# Strict v2 release version: lowercase 'v' + exactly three numeric segments.
# Rejects uppercase V and four-segment (engineering) forms.  is_release_version <v>
is_release_version() {
  printf '%s' "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
}

# The current release version = nearest lowercase release tag reachable from
# HEAD. The 'v[0-9]*' match ignores historical uppercase V… tags. Empty if none.
current_release_version() {
  git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null
}

# The annotated message (title) of a tag.  tag_title <tag>
tag_title() {
  git for-each-ref --format='%(contents:subject)' "refs/tags/$1" 2>/dev/null
}

# --- release.json (GENERATED build cache — never hand-edited) ---------------
# The git tag is the source of truth. release.json is written by release.sh as a
# build-time fallback for environments where `git describe`/tags are not visible
# (e.g. shallow CI clones). Requires node (a hard dependency of this repo).

RELEASE_JSON_FILE="${RELEASE_JSON_FILE:-release.json}"

node_present() { command -v node >/dev/null 2>&1; }

# Absolute path to release.json (resolved against repo root).
release_json_path() {
  _root="$(repo_root)"
  printf '%s/%s' "${_root:-.}" "$RELEASE_JSON_FILE"
}

# Read a top-level string key. Empty output if missing; non-zero if file absent.
# release_get <key>
release_get() {
  node_present || { log_error "node is required to read release.json" >&2; return 2; }
  node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = j[process.argv[2]];
      process.stdout.write(v == null ? "" : String(v));
    } catch (e) { process.exit(3); }
  ' "$(release_json_path)" "$1"
}

# Regenerate release.json wholesale from the tag's version + title. Humans never
# edit this file; it is always rewritten from the tag.  generate_release_json <version> <title>
generate_release_json() {
  node_present || { log_error "node is required to write release.json" >&2; return 2; }
  node -e '
    const fs = require("fs");
    const out = {
      _comment: "GENERATED by scripts/release.sh from the annotated git tag. Do NOT edit by hand. The git tag is the source of truth; this file is only a build-time fallback when tags are not visible (e.g. shallow clones).",
      version: process.argv[2],
      title: process.argv[3],
      releasedAt: process.argv[4]
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");
  ' "$(release_json_path)" "$1" "$2" "$(today_iso)"
}

# Sync package.json "version" from a release version (strips leading 'v' so it
# stays valid semver). package.json is a convenience mirror, not the source.
# sync_package_version <version>
sync_package_version() {
  node_present || { log_error "node is required to sync package.json" >&2; return 2; }
  _pv="${1#v}"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.version = process.argv[2];
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$(repo_root)/package.json" "$_pv"
}

# Today's date as YYYY-MM-DD (release stamp).
today_iso() { date -u +%Y-%m-%d; }
