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

# Looks like a release tag: V1.2.3 with optional extra .N segments and -suffix.
# Accepts capital or lowercase v (existing repo history has both).
is_version_tag() {
  printf '%s' "$1" | grep -Eq '^[Vv][0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.]+)?$'
}

# --- Roadmap / progress parsing --------------------------------------------
# These read the "Phase Execution Log" table from the ADR progress document
# (docs/adr-011-progress.md by default). The table columns are, by position:
#
#   | Phase | Name | Version | Status | Started | Completed | Notes |
#
# Split on '|', the leading empty field means: $2=Phase $3=Name $4=Version
# $5=Status. We restrict parsing to the rows between the "## Phase Execution
# Log" heading and the next "## " heading so other tables in the file (e.g.
# "Current State") can never be mistaken for phase rows.
#
# Version cells may contain more than one version (e.g. "V0.9.28 → V1.0.0").
# We always take the FIRST version token — that is the dev-release version.
#
# NOTE: the parsing strategy (markdown table) is an INTERNAL detail of these
# helpers. Callers depend only on the documented return contract, not on the
# storage format. If the progress tracker ever moves to JSON/YAML, swap the
# internals of these functions and every caller keeps working — do NOT scatter
# grep/awk over the progress file anywhere else.

# Emit the data rows of the Phase Execution Log section — header and separator
# rows are skipped, so only real phase rows are returned.
roadmap_section_rows() {
  awk '
    /^##[[:space:]]+Phase[[:space:]]+Execution[[:space:]]+Log/ { insec=1; next }
    insec && /^##[[:space:]]/ { insec=0 }
    insec && /^\|/ {
      if ($0 ~ /^\|[[:space:][:punct:]]*-{3,}/) next   # separator row |---|---|
      first=$0; sub(/^\|[[:space:]]*/, "", first)
      if (first ~ /^Phase[[:space:]]*\|/) next         # header row | Phase | Name |
      print
    }
  ' "$1"
}

# Look up a phase by id (case-insensitive). Prints "version<TAB>name<TAB>status".
# Returns non-zero if the phase is not found.  roadmap_lookup <file> <phaseId>
roadmap_lookup() {
  roadmap_section_rows "$1" | awk -F'|' -v p="$2" '
    {
      ph=$2;     gsub(/^[ \t]+|[ \t]+$/,"",ph)
      name=$3;   gsub(/^[ \t]+|[ \t]+$/,"",name)
      status=$5; gsub(/^[ \t]+|[ \t]+$/,"",status)
      if (tolower(ph) == tolower(p)) {
        if (match($4, /[Vv][0-9]+\.[0-9]+(\.[0-9]+)?/))
          ver = substr($4, RSTART, RLENGTH)
        else ver = ""
        printf "%s\t%s\t%s\n", ver, name, status
        found = 1
        exit
      }
    }
    END { if (!found) exit 1 }
  '
}

# Find the phase immediately after the given one (table order).
# Prints "phaseId<TAB>version<TAB>name"; empty output if it is the last phase.
# roadmap_next_phase <file> <phaseId>
roadmap_next_phase() {
  roadmap_section_rows "$1" | awk -F'|' -v p="$2" '
    {
      ph=$2;   gsub(/^[ \t]+|[ \t]+$/,"",ph)
      name=$3; gsub(/^[ \t]+|[ \t]+$/,"",name)
      if (match($4, /[Vv][0-9]+\.[0-9]+(\.[0-9]+)?/)) ver=substr($4,RSTART,RLENGTH)
      else ver=""
      if (take == 1) { printf "%s\t%s\t%s\n", ph, ver, name; exit }
      if (tolower(ph) == tolower(p)) take=1
    }
  '
}

# Space-separated list of all phase ids (for error messages).
# roadmap_list_phases <file>
roadmap_list_phases() {
  roadmap_section_rows "$1" | awk -F'|' '
    { ph=$2; gsub(/^[ \t]+|[ \t]+$/,"",ph); printf "%s ", ph }
  '
}

# Dump every phase, in table order, as tab-separated columns:
#   phase<TAB>version<TAB>name<TAB>status
# Used by the `next` / `status` commands to cross-reference against git state.
# roadmap_phases_tsv <file>
roadmap_phases_tsv() {
  roadmap_section_rows "$1" | awk -F'|' '
    {
      ph=$2;     gsub(/^[ \t]+|[ \t]+$/,"",ph)
      name=$3;   gsub(/^[ \t]+|[ \t]+$/,"",name)
      status=$5; gsub(/^[ \t]+|[ \t]+$/,"",status)
      if (match($4, /[Vv][0-9]+\.[0-9]+(\.[0-9]+)?/)) ver=substr($4,RSTART,RLENGTH)
      else ver=""
      printf "%s\t%s\t%s\t%s\n", ph, ver, name, status
    }
  '
}

# Derive the initiative label from the document H1, e.g.
#   "# ADR-011 — Execution Progress"  ->  "ADR-011"
# Only splits on a space-delimited dash so hyphenated codes (ADR-011) survive.
# Prints nothing if it cannot be derived.  roadmap_initiative <file>
roadmap_initiative() {
  awk '
    /^#[[:space:]]/ {
      line = $0
      sub(/^#[[:space:]]+/, "", line)
      sub(/[[:space:]]+[—–-][[:space:]].*$/, "", line)
      print line
      exit
    }
  ' "$1"
}
