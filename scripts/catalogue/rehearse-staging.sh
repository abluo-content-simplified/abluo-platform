#!/usr/bin/env bash
# Catalogue V2 — staging rehearsal (C10-6 step S), one script with pauses.
# Runs every command of RUNBOOK §4 in order; stops at the first failure.
# Writes ONLY to the Sanity dataset `staging` (and audit rows to the Abluo Sandbox
# Supabase). Production is only READ (none of these commands reads it — they use
# the P export). Usage, from the repo root:
#   export SANITY_MIGRATION_TOKEN='<token created for this run>'
#   ./scripts/catalogue/rehearse-staging.sh [backups/catalogue/p-production-<stamp>]
set -euo pipefail

P="${1:-$(ls -td backups/catalogue/p-production-* 2>/dev/null | head -1)}"
[ -n "$P" ] && [ -f "$P/catalogue.ndjson" ] || { echo "✖ No P export found (pass its folder)."; exit 1; }
[ -n "${SANITY_MIGRATION_TOKEN:-}" ] || { echo "✖ SANITY_MIGRATION_TOKEN is not set (export it in this shell first)."; exit 1; }

RUN="npx tsx scripts/catalogue"
step() { echo; echo "──── $1"; }
cont() { read -r -p "Continue? [y/N] " a; [[ "$a" =~ ^[yY]$ ]] || { echo "Stopped. Nothing further was run."; exit 0; }; }

echo "Staging rehearsal from export: $P"
echo "Every write goes to dataset 'staging' only."

step "1/7 Import the export into staging — dry run"
$RUN/import-to-staging.mjs --dataset staging --from "$P" ${REPLACE:+--replace}
cont
step "1/7 Import into staging — apply"
$RUN/import-to-staging.mjs --dataset staging --from "$P" --apply ${REPLACE:+--replace}
cont

n=2
for s in taxonomy commerce pack-history public-name; do
  step "$n/7 D-step $s — dry run"
  $RUN/migrate-$s.mjs --dataset staging --before "$P"
  cont
  step "$n/7 D-step $s — apply"
  $RUN/migrate-$s.mjs --dataset staging --before "$P" --apply
  n=$((n+1))
  cont
done

step "6/7 Independent verifications (read-only)"
for s in commerce taxonomy pack-history public-name; do
  $RUN/verify-data-step.mjs --step "$s" --dataset staging --before "$P"
done
cont

step "7/7 Idempotency: re-apply taxonomy — must report transactions: 0 and GREEN"
$RUN/migrate-taxonomy.mjs --dataset staging --before "$P" --apply

echo
echo "✔ Rehearsal complete. Reports:"
ls -t docs/engineering/catalogue-module/rollout/reports/ | head -12
echo
echo "Now: unset SANITY_MIGRATION_TOKEN, and delete the token in sanity.io/manage."
