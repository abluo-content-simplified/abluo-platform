#!/usr/bin/env node
// Abluo — migrate-commerce.mjs   (Catalogue V2, C10-6 data step D2, contract C10-3)
//
// For every catalogueItem document with non-empty `offers` and no `formats`:
// formats = legacyOffersToFormats(offers) and, in a channel project, item rules
// from legacyAvailability (D-10: default unavailable + explicit available rows);
// `offers` KEPT. Draft and published patched with the same function
// (migrateCommerceDoc). Channel entries gain active:true + defaultAvailability.
// Requires catalogueMigrations.taxonomy for the project. Verified with the C10-5
// comparison (E1–E9, class W). Marker catalogueMigrations.commerce. Audit migration.commerce.
//
// Dry run by default; --apply writes; production needs --approval <green staging report id>.
//   npx tsx scripts/catalogue/migrate-commerce.mjs --help
import { runStepCli } from './lib/cli.ts'
import { commerceStep } from './lib/step-commerce.ts'

await runStepCli(commerceStep, 'migrate-commerce.mjs')
