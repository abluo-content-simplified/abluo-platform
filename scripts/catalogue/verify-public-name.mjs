#!/usr/bin/env node
// Abluo — verify-public-name.mjs   (C11.5 proof 1 public-name.preserved + navLabel unset) — READ-ONLY.
// Same as `verify-data-step.mjs --step public-name …` (all options pass through).
// Proof 2 (website-output.unchanged) is snapshot-public-output.mjs.
//   npx tsx scripts/catalogue/verify-public-name.mjs --dataset staging --before backups/catalogue/<P export>
process.argv.splice(2, 0, '--step', 'public-name')
await import('./verify-data-step.mjs')
