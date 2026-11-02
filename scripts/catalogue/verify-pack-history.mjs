#!/usr/bin/env node
// Abluo — verify-pack-history.mjs   (C7 D3 verification) — READ-ONLY.
// Same as `verify-data-step.mjs --step pack-history …` (all options pass through).
//   npx tsx scripts/catalogue/verify-pack-history.mjs --dataset staging --before backups/catalogue/<P export>
process.argv.splice(2, 0, '--step', 'pack-history')
await import('./verify-data-step.mjs')
