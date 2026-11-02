#!/usr/bin/env node
// Abluo — verify-taxonomy.mjs   (C1.9 step 3) — READ-ONLY. The name the contract uses;
// same as `verify-data-step.mjs --step taxonomy …` (all options pass through).
//   npx tsx scripts/catalogue/verify-taxonomy.mjs --dataset staging --before backups/catalogue/<P export>
process.argv.splice(2, 0, '--step', 'taxonomy')
await import('./verify-data-step.mjs')
