#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Abluo — promote.sh
#
# Promotes dev -> preview -> production (main) in one run, asking before each
# step. Fast-forward only: a push is refused if the branches have diverged,
# so nothing on preview or main can be overwritten. Works from any branch and
# never checks anything out (safe with several worktrees).
#
#   ./scripts/promote.sh            # dev -> preview, then preview -> main
#   ./scripts/promote.sh preview    # only dev -> preview
#
# Any error stops the run.
# ---------------------------------------------------------------------------
set -euo pipefail

ask() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]] || { echo "Stopped. Nothing else was changed."; exit 0; }
}

show() { # $1 = from, $2 = to
  local list
  list=$(git log --oneline "origin/$2..origin/$1")
  if [[ -z "$list" ]]; then
    echo "  $2 already has everything from $1."
    return 1
  fi
  echo "  Commits going from $1 to $2:"
  echo "$list" | sed 's/^/    /'
}

promote() { # $1 = from, $2 = to
  echo
  echo "── $1 → $2 ─────────────────────────────────────────"
  if show "$1" "$2"; then
    ask "Push $1 to $2?"
    git push origin "origin/$1:refs/heads/$2"
    git fetch -q origin
    echo "  Done: $2 is now at $(git log -1 --format='%h %s' "origin/$2")"
  fi
}

echo "Fetching the latest state from GitHub…"
git fetch -q origin
echo "  dev:     $(git log -1 --format='%h %s' origin/dev)"
echo "  preview: $(git log -1 --format='%h %s' origin/preview)"
echo "  main:    $(git log -1 --format='%h %s' origin/main)"

promote dev preview
[[ "${1:-}" == "preview" ]] && { echo; echo "Stopped after preview, as asked."; exit 0; }

echo
echo "Wait until Vercel shows the preview deployment green and you've checked it."
ask "Preview is green and looks right. Go live (preview → production)?"
promote preview main

echo
echo "All done. Production is at $(git log -1 --format='%h %s' origin/main)."
