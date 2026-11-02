#!/usr/bin/env node
// Abluo — migrate-taxonomy.mjs   (Catalogue V2, C10-6 data step D1, contract C1.9)
//
// Creates `catalogue-taxonomy.<slug>` from the Catalogue term records
// (seedTaxonomyFromTerms; createIfNotExists — skipped where it exists) and sets
// primaryCategory/additionalCategories on every catalogueItem document
// (published AND drafts.*, same function: legacyCategoriesToAssignment) unless
// either is already present. Additive: `categories` is kept until R3.
// Marker catalogueMigrations.taxonomy (after verification). Audit migration.taxonomy.
//
// Dry run by default; --apply writes; production needs --approval <green staging report id>.
//   npx tsx scripts/catalogue/migrate-taxonomy.mjs --help
import { runStepCli } from './lib/cli.ts'
import { taxonomyStep } from './lib/step-taxonomy.ts'

await runStepCli(taxonomyStep, 'migrate-taxonomy.mjs')
