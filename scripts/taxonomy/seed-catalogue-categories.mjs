#!/usr/bin/env node
// Kept for the documented command: the Catalogue seed is seed-categories.mjs --module catalogue.
//   node scripts/taxonomy/seed-catalogue-categories.mjs --project tmz [--apply] [--json]
process.argv.splice(2, 0, '--module', 'catalogue')
await import('./seed-categories.mjs')
